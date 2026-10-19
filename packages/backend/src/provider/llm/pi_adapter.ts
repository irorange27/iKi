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
 *   along when the source part carries one), tool result parts. NOT
 *   projected (throws): approval parts (the approval-resume replay stays on
 *   the existing engine until flip — its continuation semantics are the
 *   flip redesign's input).
 * - IMAGE file parts project to Pi ImageContent (2026-10-19, multimodal).
 *   The capability decision belongs to the model owner: buildPiModel carries
 *   the catalog's modalities.input, and Pi applies them — image_url on the
 *   wire for a vision-capable model, its own placeholder text for a
 *   text-only one. iKi adds no custom warning or error on top of Pi's
 *   default. Non-image file parts (pdf/audio) still throw — Pi has no
 *   part for them on the openai-completions path.
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
 * Wired (switch item 1): the single-shot generation entry
 * (factory.generateChatWithModelMessages) routes its Pi-eligible branch
 * through callPiChat. Wired (switch item 2c): text-only streaming turns run
 * on the Pi supply layer via agent/runners/pi_text_turn_harness. Wired
 * (switch item 3a, issue #114): tool turns run via
 * agent/runners/pi_tool_turn_harness over the loop (agent/runners/
 * pi_agent_loop.ts). Wired (switch item 3b, issue #116): EVERY approval
 * policy — pause reports through the driver's registerApprovalBatch, resume
 * executes the decided calls through the five-state owner (injected port,
 * admitted before the legacy consume). Wired (switch item 3c, issue #118):
 * every mode — the turn driver rebuilds autonomous handoff-chained harnesses
 * through thread_session/turn_supply_selection.ts, so a chain never flips
 * supply mid-turn. Production callers of callPiChat: the factory and
 * the two harnesses only.
 */
import { normalizeContext } from '@earendil-works/pi-ai';
import { stream as openaiCompletionsStream } from '@earendil-works/pi-ai/api/openai-completions';
import type {
  AssistantMessage,
  ImageContent,
  Message as PiMessage,
  TextContent,
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
  /** Modalities the model accepts, in Pi's vocabulary. Drives two behaviors
   * inside Pi: whether user image parts project to image_url or get
   * downgraded to a placeholder, and reasoning-block handling. Absent means
   * text-only (Pi's own default). */
  input?: readonly string[];
  reasoning?: boolean;
  /** USD per million tokens, from the models.dev catalog record when one
   * exists. Pi's calculateCost turns these into usage.cost.total; all
   * zeros keeps cost at 0 (the pre-D35 behavior). */
  cost?: { input: number; output: number; cacheRead: number; cacheWrite: number };
};

export type PiModel = {
  id: string;
  name: string;
  api: 'openai-completions';
  provider: string;
  baseUrl: string;
  /** Mutable so it satisfies Pi's Model type verbatim (its API needs the
   * concrete `('text' | 'image')[]`, not a readonly view). The catalog's
   * modality names are a wider set; values outside the two Pi understands
   * are dropped at the MODEL BUILD (not here), so this stays the exact
   * literal union Pi declares. */
  input: Array<'text' | 'image'>;
  reasoning: boolean;
  contextWindow: number;
  maxTokens: number;
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
};

/** The catalog half of a Pi model: what the model accepts and what it
 * costs. Produced by the capability owner (resolveModelCapability in the
 * factory) and passed to buildPiModel — the adapter never fetches. */
export type PiModelCapability = {
  /** Catalog modality names ('text' | 'image' | 'pdf' | ...). */
  input?: string[];
  reasoning?: boolean | null;
  contextWindow?: number | null;
  maxTokens?: number | null;
  /** USD per million tokens; absent keys mean 0 (no cost reported). */
  cost?: { input?: number | null; output?: number | null; cacheRead?: number | null; cacheWrite?: number | null };
};

/**
 * Translate the catalog's modality names into Pi's input vocabulary. Pi's
 * openai-completions path understands exactly text and image; the catalog
 * additionally reports pdf/audio/video (2,280/845/1,561 models), which the
 * projection rejects anyway. Anything unrecognized is dropped rather than
 * passed through, so Pi's downgrade logic only ever sees a real modality.
 * Absent or empty input means text-only — the pre-D35 behavior.
 */
const piInputModalities = (input: readonly string[] | undefined): Array<'text' | 'image'> => {
  const modalities = new Set<'text' | 'image'>();
  for (const value of input ?? []) {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'text' || normalized === 'image') modalities.add(normalized);
  }
  if (modalities.size === 0) return ['text'];
  // text first: the wire reads more naturally and Pi's own models list it first.
  return modalities.has('text') ? ['text', ...(modalities.has('image') ? ['image' as const] : [])] : ['image'];
};

const nonNegativeOrZero = (value: number | null | undefined): number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;

/**
 * Build a Pi model object from iKi provider settings plus the catalog
 * capability the factory resolved (D35). The capability owner is
 * resolveModelCapability — models.dev first, stored provider options over
 * it — so this function only TRANSLATES that decision into Pi's field
 * vocabulary; it never re-fetches or re-decides. Missing capability data
 * degrades exactly like before: text-only input and zero cost rates.
 */
export const buildPiModel = (config: PiModelConfig): PiModel => ({
  id: config.id,
  name: config.id,
  api: 'openai-completions',
  provider: 'iki-custom',
  baseUrl: config.baseUrl,
  input: piInputModalities(config.input),
  reasoning: config.reasoning === true,
  contextWindow: config.contextWindow,
  maxTokens: config.maxTokens,
  cost: {
    input: nonNegativeOrZero(config.cost?.input),
    output: nonNegativeOrZero(config.cost?.output),
    cacheRead: nonNegativeOrZero(config.cost?.cacheRead),
    cacheWrite: nonNegativeOrZero(config.cost?.cacheWrite),
  },
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
  // Pi leaves reasoning undefined when the provider does not report a
  // breakdown; iKi's convention is an explicit zero.
  reasoningTokens: usage.reasoning ?? 0,
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
 * Pi's ImageContent carries `data` as a base64 string (or a Uint8Array) and
 * builds the wire data-URL itself as `data:<mimeType>;base64,<data>`. iKi's
 * file parts arrive in two real shapes from convertToModelMessages:
 *
 * - `data` bytes (Uint8Array from a pasted/dropped image), or
 * - `url` — the renderer's readAsDataURL output, an ALREADY COMPLETE
 *   `data:image/png;base64,...` string. Pi would wrap that a second time
 *   (`data:image/png;base64,data:image/png;base64,...`), so the payload
 *   after the comma is extracted here.
 *
 * Returns null for non-image media types and unresolvable payloads: the
 * caller then throws, exactly as it does for every other unrepresentable
 * part — a silent drop would hide type semantics.
 */
/**
 * Pi's ImageContent carries `data` as a base64 string (or a Uint8Array) and
 * builds the wire data-URL itself as `data:<mimeType>;base64,<data>`. iKi's
 * file parts arrive with the payload in a STRING field, and which field
 * name carries it depends on the producer:
 *
 * - `data` — what `convertToModelMessages` emits for a renderer-attached
 *   image (ai@6 dist: `{type:'file', mediaType, data: <data-URL or bytes>}`).
 *   The renderer's readAsDataURL output is a COMPLETE `data:image/png;base64,...`
 *   string, so it must be UNWRAPPED here or Pi double-wraps it into
 *   `data:image/png;base64,data:image/png;base64,...` — a URL no provider
 *   decodes. (This exact shape was the first version's bug: only `url` was
 *   unwrapped, and the real pipeline never emits `url`.)
 * - `url` — the hand-built/rehydration shape that predates that field name;
 *   treated identically.
 * - `data: Uint8Array` — raw bytes, passed through for Pi to encode.
 *
 * Returns null for non-image media types and unresolvable payloads: the
 * caller then throws, exactly as it does for every other unrepresentable
 * part — a silent drop would hide type semantics.
 */
const imageDataForPi = (part: {
  mediaType?: unknown;
  data?: unknown;
  url?: unknown;
}): string | null => {
  if (typeof part.mediaType !== 'string' || !part.mediaType.startsWith('image/')) return null;

  // Pi's ImageContent.data is a base64 STRING by type, and its adapter
  // builds the wire URL as `data:<mimeType>;base64,<data>` verbatim — so a
  // Uint8Array would be coerced to "137,80,78,71" and reach the provider as
  // garbage. Only a string payload is projectable; bytes are refused by the
  // caller's throw rather than silently corrupted.
  for (const candidate of [part.data, part.url]) {
    if (typeof candidate !== 'string' || candidate.length === 0) continue;
    // A data URL in EITHER field is a complete envelope, not a payload:
    // take what follows the comma (raw base64) so Pi wraps it exactly once.
    if (candidate.startsWith('data:')) {
      const comma = candidate.indexOf(',');
      if (comma > 0) return candidate.slice(comma + 1);
      continue;
    }
    return candidate;
  }

  return null;
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
  //
  // File parts (attached images) project to Pi ImageContent — the adapter
  // does NOT decide whether the model can see them. Pi owns that decision
  // from model.input: a vision-capable model gets the image on the wire as
  // image_url, a text-only model gets Pi's own placeholder text. iKi adds no
  // custom error or warning of its own — the library's default behavior is
  // the product decision (2026-10-19).
  const userContent = (content: unknown): string | Array<TextContent | ImageContent> => {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      const parts: Array<TextContent | ImageContent> = [];
      for (const part of content) {
        const p = part as {
          type?: string;
          text?: unknown;
          mediaType?: unknown;
          data?: unknown;
          url?: unknown;
        };
        if (p.type === 'text' && typeof p.text === 'string') {
          parts.push({ type: 'text', text: p.text });
          continue;
        }
        if (p.type === 'file' && typeof p.mediaType === 'string') {
          const data = imageDataForPi(p);
          if (data !== null) {
            parts.push({ type: 'image', data, mimeType: p.mediaType });
            continue;
          }
        }
        throw new PiProjectionError(`unsupported user part type: ${String(p.type ?? typeof part)}`);
      }
      // A single text part keeps the plain-string form — identical wire
      // content, and the shape tests/storage already expect.
      return parts.length === 1 && parts[0].type === 'text'
        ? parts[0].text
        : parts;
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
  options: { apiKey?: string; signal?: AbortSignal; maxTokens?: number; temperature?: number } = {}
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
      ...(typeof options.temperature === 'number' ? { temperature: options.temperature } : {}),
    }
  );
