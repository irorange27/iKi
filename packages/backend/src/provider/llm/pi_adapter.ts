/**
 * Pi supply adapter — the projection layer between iKi's model history and
 * the Pi-AI supply library (stage D flip precondition, issue #98).
 *
 * Ownership (review F3): this module owns protocol/message projection ONLY.
 * History authority, budgets, tool execution, approval decisions and fact
 * commits stay with their existing owners. The projection's output is a
 * request-level ephemeral: it is NEVER persisted.
 *
 * Format/version contract (review F2, before any production write): adopting
 * Pi changes NO persisted format — chat_messages (sanitized UI JSON),
 * session_events, run working and approval plan_json keep their owners and
 * shapes. Rollback therefore separates code revert (always possible while
 * this module is unwired) from already-written data (readable by the
 * pre-Pi code, because nothing Pi-shaped is stored) from irrevocable facts
 * (model calls made, tool effects executed).
 *
 * Projection rules (review F4/F5, corrected by rereview G2/G6):
 * - Covered input domain: the text + tools subset of ModelMessage shapes —
 *   user text parts AND plain strings, assistant text/tool-call/reasoning
 *   parts (reasoning maps to a Pi thinking block; a provider signature rides
 *   along when the source part carries one), tool result parts. NOT yet
 *   projected (throws): approval parts (the approval-resume replay stays on
 *   the existing engine until flip — its continuation semantics are the
 *   flip redesign's input), image/file parts (multimodal undecided).
 * - Assistant envelopes are SYNTHESIZED as a compatibility assumption for
 *   Pi's type contract — they are not recorded facts. iKi history CAN
 *   contain partial assistant text: the cancel branch persists interrupted
 *   messages (persistAssistantTurnMessage 'stream-abort') and they re-enter
 *   history on the next request. Whether a partial belongs in later context
 *   is the recovery/context owner's decision (today: it stays and is
 *   projected); this module only projects that decision and must not fake
 *   provenance. What history cannot contain is an assistant message in the
 *   error/aborted STATE: interrupted tool parts are repaired into paired
 *   error results (ui_messages), and stream errors never append because
 *   only onStepFinish appends (simple_agent_runner). Future reasoning and
 *   cross-model versions must carry real provenance instead of this stamp.
 * - Tool schemas are consumed as-is from the existing owner
 *   (BaseTool.parameters — plain JSON Schema). Strict normalization is NOT
 *   requested by this adapter (it never sets constrainedSampling); note that
 *   for models whose compat advertises strict support the wire still carries
 *   `strict: false` — flip-time wire diffs should expect that field.
 * - Unrepresentable parts and output types throw PiProjectionError — never a
 *   silent drop, and never a stringify that hides type semantics (G3).
 *
 * This module is UNWIRED: no production path imports callPiChat yet. Wiring
 * it into the send path is the flip decision (with its own gates).
 */
import { normalizeContext } from '@earendil-works/pi-ai';
import { stream as openaiCompletionsStream } from '@earendil-works/pi-ai/api/openai-completions';
import type {
  AssistantMessage,
  Message as PiMessage,
  ThinkingContent,
  Tool as PiTool,
  ToolCall,
  ToolResultMessage,
  Usage as PiUsage,
} from '@earendil-works/pi-ai';
import type { ChatInputMessage } from '@iki/backend/message/chat_message_types';

export class PiProjectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PiProjectionError';
  }
}

/** A Pi chat model as iKi's provider config produces it. */
export type PiModelConfig = {
  id: string;
  baseUrl: string;
  contextWindow: number;
  maxTokens: number;
};

export type PiModel = {
  id: string;
  name: string;
  api: 'openai-completions';
  provider: string;
  baseUrl: string;
  input: ('text' | 'image')[];
  reasoning: boolean;
  contextWindow: number;
  maxTokens: number;
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
};

/**
 * Build a Pi model object from iKi provider settings. The explicit-field
 * shape mirrors the scripted models used in tests; provider catalog
 * integration (D35) arrives with the factory wiring at flip time.
 */
export const buildPiModel = (config: PiModelConfig): PiModel => ({
  id: config.id,
  name: config.id,
  api: 'openai-completions',
  provider: 'iki-custom',
  baseUrl: config.baseUrl,
  input: ['text'],
  reasoning: false,
  contextWindow: config.contextWindow,
  maxTokens: config.maxTokens,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
});

/**
 * Project iKi tool declarations onto the Pi wire shape. `parameters` is the
 * existing JSON Schema owner's output (BaseTool.parameters), consumed
 * as-is — never regenerated, never strict-normalized (see module doc).
 */
export const projectToolsToPiTools = (
  tools: Array<{ name: string; description: string; parameters: Record<string, unknown> }>
): PiTool[] =>
  tools.map(tool => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters as PiTool['parameters'],
  }));

/**
 * Pi's Usage.input EXCLUDES cached tokens by documented design
 * (input = prompt_tokens − cacheRead − cacheWrite). iKi's usage recording
 * keeps the total-prompt convention, so the buckets map explicitly:
 * inputTokens restores the cache hits/writes Pi carved out.
 */
export const projectUsageToIki = (usage: PiUsage) => ({
  inputTokens: usage.input + usage.cacheRead + usage.cacheWrite,
  outputTokens: usage.output,
  cacheReadTokens: usage.cacheRead,
  cacheWriteTokens: usage.cacheWrite,
  reasoningTokens: usage.reasoning,
  totalTokens: usage.totalTokens,
});

/**
 * The synthesized assistant envelope. Zero usage: historical messages do not
 * contribute usage accounting (only live calls do, via projectUsageToIki).
 * stopReason 'stop' is structurally required. It is NOT a guard against
 * misjudgment: a partial stamped 'stop' presents itself as complete on the
 * wire — the stamp is part of the synthesized assumption, nothing more. The
 * STATE is what projection input never carries (see the module doc): tool
 * repair pairs interrupted tool parts, and stream errors never append to
 * history — partial TEXT however can be present (cancel-branch persistence)
 * and is projected as-is.
 */
const synthesizedEnvelope = (modelId: string) => ({
  api: 'openai-completions',
  provider: 'iki-custom',
  model: modelId,
  usage: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  },
  stopReason: 'stop' as const,
  timestamp: Date.now(),
});

/**
 * Exhaustive projection of the AI SDK ToolResultOutput union. `json` values
 * are textified as the documented protocol (a JSON tool result read by the
 * model as text); `content` parts project text and REFUSE media — images and
 * files are outside the covered text+tools domain and must never hide inside
 * a stringified value. `execution-denied` mirrors the persisted-read path's
 * mapping (an approval denial becomes an error tool result).
 */
const projectToolOutput = (output: unknown): { text: string; isError: boolean } => {
  if (output === null || typeof output !== 'object' || !('type' in output)) {
    throw new PiProjectionError('tool-result output must be a typed AI SDK output');
  }
  const o = output as { type: string; value?: unknown; reason?: unknown };
  switch (o.type) {
    case 'text':
      return { text: typeof o.value === 'string' ? o.value : JSON.stringify(o.value ?? null), isError: false };
    case 'error-text':
      return { text: typeof o.value === 'string' ? o.value : JSON.stringify(o.value ?? null), isError: true };
    case 'json':
      return { text: JSON.stringify(o.value ?? null), isError: false };
    case 'error-json':
      return { text: JSON.stringify(o.value ?? null), isError: true };
    case 'execution-denied':
      return {
        text: typeof o.reason === 'string' ? o.reason : 'Tool call execution denied.',
        isError: true,
      };
    case 'content': {
      if (!Array.isArray(o.value)) {
        throw new PiProjectionError('content tool-result output must be a part array');
      }
      const texts: string[] = [];
      for (const part of o.value) {
        const p = part as { type?: unknown; text?: unknown };
        if (p.type === 'text' && typeof p.text === 'string') {
          texts.push(p.text);
          continue;
        }
        throw new PiProjectionError(`unsupported tool-result content part: ${String(p.type ?? typeof part)}`);
      }
      return { text: texts.join(''), isError: false };
    }
    default:
      throw new PiProjectionError(`unsupported tool-result output type: ${String(o.type)}`);
  }
};

/**
 * Project iKi's prepared history (ChatInputMessage — the AI SDK ModelMessage
 * shapes toModelInputMessages emits) into Pi messages.
 *
 * The FIRST system message becomes `systemPrompt`; mid-conversation system
 * messages map to Pi SystemMessages (Pi replays them as additional
 * instructions). Unrepresentable parts throw — the projection never drops.
 */
export const projectHistoryToPiContext = (
  messages: ChatInputMessage[],
  modelId: string
): { systemPrompt: string; messages: PiMessage[] } => {
  const piMessages: PiMessage[] = [];
  let systemPrompt = '';

  const stringContent = (role: string, content: unknown): string => {
    if (typeof content === 'string') return content;
    throw new PiProjectionError(
      `unsupported ${role} content shape: expected string, got ${Array.isArray(content) ? 'part array' : typeof content}`
    );
  };

  // convertToModelMessages emits user content as a PART ARRAY — even for a
  // single text part (ai@6 dist: `content: message.parts.map(...)`). The
  // string form never occurs from the real pipeline; it is accepted because
  // tests (and rehydration paths) hand it to the projection directly.
  const userContent = (content: unknown): string => {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      const texts: string[] = [];
      for (const part of content) {
        const p = part as { type?: string; text?: unknown };
        if (p.type === 'text' && typeof p.text === 'string') {
          texts.push(p.text);
          continue;
        }
        throw new PiProjectionError(`unsupported user part type: ${String(p.type ?? typeof part)}`);
      }
      return texts.join('');
    }
    throw new PiProjectionError(`unsupported user content shape: ${typeof content}`);
  };

  for (const message of messages) {
    const m = message as { role: string; content: unknown };
    switch (m.role) {
      case 'system': {
        const text = stringContent('system', m.content);
        if (!systemPrompt) {
          systemPrompt = text;
        } else {
          piMessages.push({ role: 'system', content: text, timestamp: Date.now() });
        }
        break;
      }
      case 'user': {
        piMessages.push({
          role: 'user',
          content: userContent(m.content),
          timestamp: Date.now(),
        });
        break;
      }
      case 'assistant': {
        const content: AssistantMessage['content'] = [];
        const raw = m.content;
        if (typeof raw === 'string') {
          if (raw) content.push({ type: 'text', text: raw });
        } else if (Array.isArray(raw)) {
          for (const part of raw) {
            const p = part as {
              type?: string;
              text?: unknown;
              input?: unknown;
              toolCallId?: unknown;
              toolName?: unknown;
              providerOptions?: { anthropic?: { signature?: unknown } };
            };
            if (p.type === 'text' && typeof p.text === 'string') {
              content.push({ type: 'text', text: p.text });
            } else if (p.type === 'reasoning' && typeof p.text === 'string') {
              // Reasoning projects to a Pi thinking block. A provider signature
              // rides along when the source part carries one (best-effort
              // provenance — flip-time work owns the full cross-model story).
              const thinking: ThinkingContent = { type: 'thinking', thinking: p.text };
              const signature = p.providerOptions?.anthropic?.signature;
              if (typeof signature === 'string' && signature) {
                thinking.thinkingSignature = signature;
              }
              content.push(thinking);
            } else if (p.type === 'tool-call') {
              if (typeof p.toolCallId !== 'string' || typeof p.toolName !== 'string') {
                throw new PiProjectionError('tool-call part missing toolCallId/toolName');
              }
              const toolCall: ToolCall = {
                type: 'toolCall',
                id: p.toolCallId,
                name: p.toolName,
                arguments: (p.input ?? {}) as ToolCall['arguments'],
              };
              content.push(toolCall);
            } else {
              throw new PiProjectionError(`unsupported assistant part type: ${String(p.type ?? typeof part)}`);
            }
          }
        } else {
          throw new PiProjectionError('unsupported assistant content shape');
        }
        piMessages.push({
          role: 'assistant',
          content,
          ...synthesizedEnvelope(modelId),
        } satisfies AssistantMessage);
        break;
      }
      case 'tool': {
        if (!Array.isArray(m.content)) {
          throw new PiProjectionError('tool message content must be a part array');
        }
        for (const part of m.content) {
          const p = part as {
            type?: unknown;
            toolCallId?: unknown;
            toolName?: unknown;
            output?: unknown;
          };
          if (p.type !== 'tool-result') {
            throw new PiProjectionError(`unsupported tool part type: ${String(p.type ?? typeof part)}`);
          }
          if (typeof p.toolCallId !== 'string' || typeof p.toolName !== 'string') {
            throw new PiProjectionError('tool-result part missing toolCallId/toolName');
          }
          // Exhaustive over the AI SDK ToolResultOutput union (rereview G3):
          // the previous draft stringified unknown outputs, which silently
          // textified media inside `content` values.
          const { text: resultText, isError } = projectToolOutput(p.output);
          const toolResult: ToolResultMessage = {
            role: 'toolResult',
            toolCallId: p.toolCallId,
            toolName: p.toolName,
            content: [{ type: 'text', text: resultText }],
            isError,
            timestamp: Date.now(),
          };
          piMessages.push(toolResult);
        }
        break;
      }
      default:
        throw new PiProjectionError(`unsupported message role: ${String(m.role)}`);
    }
  }

  return { systemPrompt, messages: piMessages };
};

export type PiChatCallContext = {
  messages: PiMessage[];
  tools?: PiTool[];
};

/**
 * The narrow call surface: one model call over a caller-assembled, already
 * projected transcript. Uses the real openai-completions stream function —
 * production wiring points send paths HERE, and nowhere else imports the
 * pi-ai runtime.
 */
export const callPiChat = (
  model: PiModel,
  context: PiChatCallContext & { systemPrompt: string },
  options: { apiKey?: string; signal?: AbortSignal; maxTokens?: number } = {}
): ReturnType<typeof openaiCompletionsStream> =>
  openaiCompletionsStream(
    model,
    normalizeContext({
      systemPrompt: context.systemPrompt,
      messages: context.messages as never,
      tools: context.tools as never,
    }),
    {
      apiKey: options.apiKey,
      signal: options.signal,
      ...(typeof options.maxTokens === 'number' ? { maxTokens: options.maxTokens } : {}),
    }
  );
