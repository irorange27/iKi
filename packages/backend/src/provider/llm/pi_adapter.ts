
import { normalizeContext } from '@earendil-works/pi-ai';
import { stream as openaiCompletionsStream } from '@earendil-works/pi-ai/api/openai-completions';
import { stream as openaiResponsesStream } from '@earendil-works/pi-ai/api/openai-responses';
import { stream as anthropicMessagesStream } from '@earendil-works/pi-ai/api/anthropic-messages';
import type {
  AssistantMessage,
  ImageContent,
  Message as PiMessage,
  TextContent,
  Tool as PiTool,
  ToolCall,
  ToolResultMessage,
  Usage as PiUsage,
} from '@earendil-works/pi-ai';
import type { ChatInputMessage } from '@iki/backend/message/chat_message_types';

const ANTHROPIC_PROVIDER_TYPE = 'anthropic';

class PiProjectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PiProjectionError';
  }
}

export type PiApiKind = 'openai-completions' | 'openai-responses' | 'anthropic-messages';

export type PiModelCompat =
  | {
      supportsDeveloperRole: false;
      supportsReasoningEffort: false;
      supportsMidConvoSystemMessages: false;
      requiresReasoningContentOnAssistantMessages: false;
    }
  | {
      supportsDeveloperRole: false;
      supportsMidConvoSystemMessages: false;
    }
  | {

      supportsEagerToolInputStreaming: boolean;
    };

export type PiModelConfig = {
  id: string;

  api?: PiApiKind;

  providerType?: string;
  baseUrl: string;
  contextWindow: number;
  maxTokens: number;

  input?: readonly string[];

  cost?: { input: number; output: number; cacheRead: number; cacheWrite: number };
};

export type PiModel = {
  id: string;
  name: string;

  api: PiApiKind;

  provider: string;
  baseUrl: string;

  input: Array<'text' | 'image'>;

  reasoning: false;

  compat: PiModelCompat;
  contextWindow: number;
  maxTokens: number;
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
};

export type PiModelCapability = {

  input?: string[];
  reasoning?: boolean | null;
  contextWindow?: number | null;
  maxTokens?: number | null;

  cost?: { input?: number | null; output?: number | null; cacheRead?: number | null; cacheWrite?: number | null };
};

const piInputModalities = (input: readonly string[] | undefined): Array<'text' | 'image'> => {
  const modalities = new Set<'text' | 'image'>();
  for (const value of input ?? []) {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'text' || normalized === 'image') modalities.add(normalized);
  }
  if (modalities.size === 0) return ['text'];

  return modalities.has('text') ? ['text', ...(modalities.has('image') ? ['image' as const] : [])] : ['image'];
};

const nonNegativeOrZero = (value: number | null | undefined): number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;

export const buildPiModel = (config: PiModelConfig): PiModel => {
  const api: PiApiKind = config.api ?? 'openai-completions';

  const compat: PiModelCompat =
    api === 'openai-responses'
      ? { supportsDeveloperRole: false, supportsMidConvoSystemMessages: false }
      : api === 'anthropic-messages'
        ? { supportsEagerToolInputStreaming: true }
        : {
            supportsDeveloperRole: false,
            supportsReasoningEffort: false,
            supportsMidConvoSystemMessages: false,
            requiresReasoningContentOnAssistantMessages: false,
          };

  return {
    id: config.id,
    name: config.id,
    api,
    provider: config.providerType?.trim() || 'unknown',
    baseUrl: config.baseUrl,
    input: piInputModalities(config.input),
    reasoning: false,
    compat,
    contextWindow: config.contextWindow,
    maxTokens: config.maxTokens,
    cost: {
      input: nonNegativeOrZero(config.cost?.input),
      output: nonNegativeOrZero(config.cost?.output),
      cacheRead: nonNegativeOrZero(config.cost?.cacheRead),
      cacheWrite: nonNegativeOrZero(config.cost?.cacheWrite),
    },
  } as PiModel;
};

export const projectToolsToPiTools = (
  tools: Array<{ name: string; description: string; parameters: Record<string, unknown> }>
): PiTool[] =>
  tools.map(tool => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters as PiTool['parameters'],
  }));

export const projectUsageToIki = (usage: PiUsage) => ({
  inputTokens: usage.input + usage.cacheRead + usage.cacheWrite,
  outputTokens: usage.output,
  cacheReadTokens: usage.cacheRead,
  cacheWriteTokens: usage.cacheWrite,

  reasoningTokens: usage.reasoning ?? 0,
  totalTokens: usage.totalTokens,
});

const synthesizedEnvelope = (modelId: string, providerType?: string) => ({
  api: 'openai-completions',
  provider: providerType?.trim() || 'unknown',
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

const imageDataForPi = (part: {
  mediaType?: unknown;
  data?: unknown;
  url?: unknown;
}): string | null => {
  if (typeof part.mediaType !== 'string' || !part.mediaType.startsWith('image/')) return null;

  for (const candidate of [part.data, part.url]) {
    if (typeof candidate !== 'string' || candidate.length === 0) continue;

    if (candidate.startsWith('data:')) {
      const comma = candidate.indexOf(',');
      if (comma > 0) return candidate.slice(comma + 1);
      continue;
    }

    return candidate;
  }

  return null;
};

export const projectHistoryToPiContext = (
  messages: ChatInputMessage[],
  modelId: string,
  providerType?: string
): { systemPrompt: string; messages: PiMessage[] } => {
  const piMessages: PiMessage[] = [];
  let systemPrompt = '';
  const projectionProviderType = providerType?.trim() || undefined;

  const stringContent = (role: string, content: unknown): string => {
    if (typeof content === 'string') return content;
    throw new PiProjectionError(
      `unsupported ${role} content shape: expected string, got ${Array.isArray(content) ? 'part array' : typeof content}`
    );
  };

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

              const signature = p.providerOptions?.anthropic?.signature;
              const hasSignature = typeof signature === 'string' && signature.length > 0;

              const signatureStillValid =
                hasSignature &&
                projectionProviderType === ANTHROPIC_PROVIDER_TYPE &&
                providerType === ANTHROPIC_PROVIDER_TYPE;
              if (signatureStillValid) {
                content.push({ type: 'thinking', thinking: p.text, thinkingSignature: signature });
              } else if (hasSignature) {

                content.push({ type: 'text', text: p.text });
              } else {

                content.push({ type: 'thinking', thinking: p.text });
              }
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
          ...synthesizedEnvelope(modelId, projectionProviderType),
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

export const callPiChat = (
  model: PiModel,
  context: PiChatCallContext & { systemPrompt: string },
  options: { apiKey?: string; signal?: AbortSignal; maxTokens?: number; temperature?: number } = {}
): ReturnType<typeof openaiCompletionsStream> => {
  const piContext = normalizeContext({
    systemPrompt: context.systemPrompt,
    messages: context.messages as never,
    tools: context.tools as never,
  });
  const streamOptions = {
    apiKey: options.apiKey,
    signal: options.signal,
    ...(typeof options.maxTokens === 'number' ? { maxTokens: options.maxTokens } : {}),
    ...(typeof options.temperature === 'number' ? { temperature: options.temperature } : {}),
  };

  if (model.api === 'anthropic-messages') {
    return anthropicMessagesStream(
      model as never,
      piContext,
      streamOptions
    ) as unknown as ReturnType<typeof openaiCompletionsStream>;
  }

  if (model.api === 'openai-responses') {

    return openaiResponsesStream(
      model as never,
      piContext,
      streamOptions
    ) as unknown as ReturnType<typeof openaiCompletionsStream>;
  }

  return openaiCompletionsStream(
    model as never,
    piContext,
    streamOptions
  ) as unknown as ReturnType<typeof openaiCompletionsStream>;
};
