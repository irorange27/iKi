import { convertToModelMessages, validateUIMessages, type UIMessageChunk } from 'ai';

import { extractTextFromModelMessageContent } from '../../../core/agent/model_messages';
import { defaultToolRegistry } from '../../../core/tools';
import type {
  DynamicToolPart,
  DynamicToolState,
  TextPart,
  UiMessagePart,
} from '../../../shared/chat/message_parts';
import {
  getApprovalId,
  getToolCallIdFromPart,
  getToolInput,
  getToolName,
  getToolOutput,
  isObjectRecord,
  normalizeDynamicToolPart,
} from '../../../shared/chat/tool_parts';
import { getErrorMessage } from '../../utils/errors';
import type {
  ChatInputMessage,
  ChatTransportMessage,
  ChatUiMessage,
  ChatWebContents,
  LlmChatMessage,
  ToolStreamEvent,
  UiChunkEmitter,
} from './chat_types';
export { parseStoredUiMessageRow } from '../../../shared/chat/ui_message_codec';

const createRuntimeId = (prefix: string) =>
  `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

const getNestedToolEventField = (
  event: ToolStreamEvent,
  field: 'toolCallId' | 'toolName'
): unknown => {
  if (field in event) return event[field];
  const nestedToolCall = event.toolCall;
  if (!isObjectRecord(nestedToolCall)) return undefined;
  return nestedToolCall[field];
};

const getToolCallIdFromEvent = (event: ToolStreamEvent): string => {
  const candidate =
    typeof getNestedToolEventField(event, 'toolCallId') === 'string'
      ? (getNestedToolEventField(event, 'toolCallId') as string)
      : typeof event.id === 'string'
        ? event.id
        : '';

  if (candidate.length > 0) return candidate;
  return createRuntimeId('tool_call');
};

const getToolNameFromEvent = (event: ToolStreamEvent): string =>
  typeof getNestedToolEventField(event, 'toolName') === 'string' &&
  (getNestedToolEventField(event, 'toolName') as string).length > 0
    ? (getNestedToolEventField(event, 'toolName') as string)
    : 'tool';

const getToolDisplayTitle = (toolName: string): string | undefined => {
  const tool = defaultToolRegistry.get(toolName);
  if (tool) {
    const baseName =
      typeof tool.displayName === 'string' && tool.displayName.trim()
        ? tool.displayName.trim()
        : tool.name;
    return baseName;
  }
  if (toolName.startsWith('mcp:')) {
    const slashIndex = toolName.lastIndexOf('/');
    if (slashIndex >= 0 && slashIndex < toolName.length - 1) {
      return toolName.slice(slashIndex + 1);
    }
  }
  const mcpMatch = toolName.match(/^mcp_[a-f0-9]{8}_(.+)$/);
  if (mcpMatch && mcpMatch[1]) {
    return mcpMatch[1];
  }
  return undefined;
};

const DYNAMIC_TOOL_STATES = new Set<DynamicToolState>([
  'input-streaming',
  'input-available',
  'approval-requested',
  'approval-responded',
  'output-available',
  'output-error',
  'output-denied',
  'done',
]);

const isDynamicToolState = (value: unknown): value is DynamicToolState =>
  typeof value === 'string' && DYNAMIC_TOOL_STATES.has(value as DynamicToolState);

const normalizeToolPartForValidation = (
  part: Record<string, unknown>,
  fallbackToolCallId: string
): DynamicToolPart | null => {
  const partType = typeof part.type === 'string' ? part.type : '';
  if (!partType) return null;

  if (partType === 'dynamic-tool') {
    return normalizeDynamicToolPart(part, fallbackToolCallId);
  }

  if (!partType.startsWith('tool-')) return null;

  const toolCallId = getToolCallIdFromPart(part) ?? fallbackToolCallId;
  const baseToolName = getToolName(part) || 'tool';
  const input = getToolInput(part);
  const output = getToolOutput(part);

  if (partType === 'tool-call') {
    return normalizeDynamicToolPart(
      {
        ...part,
        toolCallId,
        toolName: baseToolName,
        input: input ?? {},
        ...(isDynamicToolState(part.state) ? { state: part.state } : {}),
      },
      toolCallId
    );
  }

  if (partType === 'tool-result') {
    const nextState = isDynamicToolState(part.state) ? part.state : 'output-available';
    return normalizeDynamicToolPart(
      {
        ...part,
        toolCallId,
        toolName: baseToolName,
        input: input ?? {},
        output: output ?? null,
        state: nextState,
      },
      toolCallId
    );
  }

  if (partType === 'tool-approval-request') {
    const approvalId = getApprovalId(part) ?? `${toolCallId}_approval`;
    return normalizeDynamicToolPart(
      {
        ...part,
        toolCallId,
        toolName: baseToolName,
        input: input ?? {},
        state: 'approval-requested',
        approval: { id: approvalId },
      },
      toolCallId
    );
  }

  if (partType === 'tool-approval-response') {
    const approvalId = getApprovalId(part) ?? `${toolCallId}_approval`;
    const approved = typeof part.approved === 'boolean' ? part.approved : false;
    const reason =
      typeof part.reason === 'string' && part.reason.trim().length > 0 ? part.reason : undefined;
    const approval = {
      id: approvalId,
      approved,
      ...(reason ? { reason } : {}),
    };

    return normalizeDynamicToolPart(
      {
        ...part,
        toolCallId,
        toolName: baseToolName,
        input: input ?? {},
        state: approved ? 'approval-responded' : 'output-denied',
        approval,
      },
      toolCallId
    );
  }

  const inferredToolName = partType.slice(5).trim();
  return normalizeDynamicToolPart(
    {
      ...part,
      toolCallId,
      toolName: inferredToolName || baseToolName,
      input: input ?? {},
      ...(output !== undefined ? { output } : {}),
      ...(isDynamicToolState(part.state) ? { state: part.state } : {}),
    },
    toolCallId
  );
};

const normalizeUiMessagesForValidation = (messages: ChatUiMessage[]): ChatUiMessage[] =>
  messages.flatMap((message, messageIndex) => {
    const messageId =
      typeof message.id === 'string' && message.id.length > 0
        ? message.id
        : createRuntimeId(`ui_msg_${messageIndex}`);

    const role =
      message.role === 'system' || message.role === 'user' || message.role === 'assistant'
        ? message.role
        : 'user';

    const parts: UiMessagePart[] = Array.isArray(message.parts)
      ? message.parts
          .map((part, partIndex) => {
            if (!isObjectRecord(part)) return null;
            const partRecord = part as Record<string, unknown>;
            const partType = typeof partRecord.type === 'string' ? partRecord.type : '';
            if (!partType) return null;
            if (partType === 'dynamic-tool' || partType.startsWith('tool-')) {
              return normalizeToolPartForValidation(partRecord, `${messageId}_tool_${partIndex}`);
            }
            if (partType === 'memory-retrieval') {
              return null;
            }
            if (partType === 'text' && typeof partRecord.text === 'string') {
              const textPart: TextPart = {
                type: 'text',
                text: partRecord.text,
                ...(typeof partRecord.state === 'string'
                  ? { state: partRecord.state as TextPart['state'] }
                  : {}),
              };
              return textPart;
            }
            return null;
          })
          .filter((part): part is TextPart | DynamicToolPart => part !== null)
      : [];

    if (parts.length === 0) {
      return [];
    }

    return [
      {
        id: messageId,
        role,
        ...(message.metadata !== undefined ? { metadata: message.metadata } : {}),
        parts: parts as ChatUiMessage['parts'],
      },
    ];
  });

export const sanitizeUiMessageJsonForStorage = (raw: string): string => {
  if (typeof raw !== 'string') return String(raw);
  const trimmed = raw.trim();
  if (!trimmed) return raw;

  try {
    const parsed = JSON.parse(trimmed);
    if (!isObjectRecord(parsed)) return raw;

    const role =
      parsed.role === 'system' || parsed.role === 'assistant' || parsed.role === 'user'
        ? parsed.role
        : 'user';

    const sanitized: Record<string, unknown> = { role };
    const parts = Array.isArray(parsed.parts) ? parsed.parts : null;

    if (parts) {
      const nextParts: Array<Record<string, unknown>> = [];
      for (const part of parts) {
        if (!isObjectRecord(part) || typeof part.type !== 'string') continue;

        if (part.type === 'text') {
          if (typeof part.text !== 'string') continue;
          nextParts.push({ type: 'text', text: part.text });
          continue;
        }

        if (part.type === 'dynamic-tool') {
          const normalized = normalizeDynamicToolPart(part, createRuntimeId('tool_call'));

          // Keep only semantically meaningful fields; drop renderer-only UI state.
          delete normalized.callProviderMetadata;

          nextParts.push(normalized);
          continue;
        }

        if (part.type === 'memory-retrieval') {
          const normalized: Record<string, unknown> = {
            type: 'memory-retrieval',
          };
          if (typeof part.query === 'string' && part.query.trim()) {
            normalized.query = part.query.trim();
          }
          if (Array.isArray(part.results)) {
            normalized.results = part.results.filter(
              entry => entry && typeof entry === 'object' && 'summary' in entry
            );
          } else {
            normalized.results = [];
          }
          nextParts.push(normalized);
        }
      }

      sanitized.parts = nextParts;
    } else if (typeof parsed.content === 'string') {
      sanitized.parts = [{ type: 'text', text: parsed.content }];
    }

    return JSON.stringify(sanitized);
  } catch {
    return raw;
  }
};

const toUiChunkFromToolEvent = (event: ToolStreamEvent): UIMessageChunk | null => {
  const toolCallId = getToolCallIdFromEvent(event);
  const toolName = getToolNameFromEvent(event);
  const title = getToolDisplayTitle(toolName);

  if (event.type === 'tool-input-start') {
    return {
      type: 'tool-input-start',
      toolCallId,
      toolName,
      ...(title ? { title } : {}),
      dynamic: true,
    };
  }
  if (event.type === 'tool-input-delta') {
    return {
      type: 'tool-input-delta',
      toolCallId,
      inputTextDelta: typeof event.delta === 'string' ? event.delta : '',
    };
  }
  if (event.type === 'tool-input-end') {
    return null;
  }
  if (event.type === 'tool-call') {
    if (event.invalid) {
      return {
        type: 'tool-input-error',
        toolCallId,
        toolName,
        input: event.input ?? {},
        errorText:
          typeof event.error === 'string'
            ? event.error
            : event.error instanceof Error
              ? event.error.message
              : 'Invalid tool call',
        ...(title ? { title } : {}),
        dynamic: true,
      };
    }
    return {
      type: 'tool-input-available',
      toolCallId,
      toolName,
      input: event.input ?? {},
      ...(title ? { title } : {}),
      dynamic: true,
    };
  }
  if (event.type === 'tool-result') {
    const chunk = {
      type: 'tool-output-available',
      toolCallId,
      toolName,
      output: event.output,
      dynamic: true,
      ...(title ? { title } : {}),
      ...(typeof event.preliminary === 'boolean' ? { preliminary: event.preliminary } : {}),
    };
    return chunk as unknown as UIMessageChunk;
  }
  if (event.type === 'tool-error') {
    const chunk = {
      type: 'tool-output-error',
      toolCallId,
      toolName,
      errorText:
        typeof event.error === 'string'
          ? event.error
          : event.error instanceof Error
            ? event.error.message
            : 'Tool execution failed',
      ...(title ? { title } : {}),
      dynamic: true,
    };
    return chunk as unknown as UIMessageChunk;
  }
  if (event.type === 'tool-output-denied') {
    return {
      type: 'tool-output-denied',
      toolCallId,
    };
  }
  if (event.type === 'tool-approval-request') {
    return {
      type: 'tool-approval-request',
      approvalId:
        typeof event.approvalId === 'string' && event.approvalId.length > 0
          ? event.approvalId
          : createRuntimeId('approval'),
      toolCallId,
    };
  }

  return null;
};

export const createUiChunkEmitter = (
  webContents: ChatWebContents,
  messageId: string = createRuntimeId('assistant')
): UiChunkEmitter => {
  let started = false;
  let textStarted = false;
  let terminated = false;

  const emitChunk = (
    chunk:
      | UIMessageChunk
      | { type: 'memory-retrieval'; query?: string; results?: Array<Record<string, unknown>> }
  ) => {
    webContents.send('chat:ui-chunk', chunk);
  };

  const ensureStarted = () => {
    if (started || terminated) return;
    emitChunk({ type: 'start', messageId });
    started = true;
  };

  const ensureTextStarted = () => {
    ensureStarted();
    if (textStarted || terminated) return;
    emitChunk({ type: 'text-start', id: messageId });
    textStarted = true;
  };

  const closeText = () => {
    if (!textStarted || terminated) return;
    emitChunk({ type: 'text-end', id: messageId });
    textStarted = false;
  };

  return {
    messageId,
    emitTextDelta: delta => {
      if (!delta || terminated) return;
      ensureTextStarted();
      emitChunk({ type: 'text-delta', id: messageId, delta });
    },
    emitToolEvent: event => {
      if (terminated) return;
      ensureStarted();
      const uiChunk = toUiChunkFromToolEvent(event);
      if (uiChunk) emitChunk(uiChunk);
    },
    emitMemoryRetrieval: payload => {
      if (terminated) return;
      ensureStarted();
      emitChunk({
        type: 'memory-retrieval',
        query: payload?.query ?? '',
        results: Array.isArray(payload?.results) ? payload.results : [],
      });
    },
    finish: () => {
      if (terminated) return;
      ensureStarted();
      closeText();
      emitChunk({ type: 'finish' });
      terminated = true;
    },
    abort: () => {
      if (terminated) return;
      ensureStarted();
      closeText();
      emitChunk({ type: 'abort' });
      terminated = true;
    },
    error: errorText => {
      if (terminated) return;
      ensureStarted();
      closeText();
      emitChunk({ type: 'error', errorText });
    },
  };
};

const isUiMessage = (value: unknown): value is ChatUiMessage =>
  isObjectRecord(value) &&
  typeof value.role === 'string' &&
  Array.isArray((value as { parts?: unknown }).parts);

export const toModelInputMessages = async (
  messages: ChatTransportMessage[] | unknown[]
): Promise<ChatInputMessage[]> => {
  if (!Array.isArray(messages) || messages.length === 0) return [];

  if (messages.every(isUiMessage)) {
    const normalizedUiMessages = normalizeUiMessagesForValidation(messages as ChatUiMessage[]);
    if (normalizedUiMessages.length === 0) return [];

    try {
      await validateUIMessages({
        messages: normalizedUiMessages,
      });
    } catch (error: unknown) {
      throw new Error(`Invalid UI messages: ${getErrorMessage(error)}`);
    }

    try {
      return await convertToModelMessages(
        normalizedUiMessages.map(message => {
          const { id, ...rest } = message;
          void id;
          return rest;
        }),
        {
          ignoreIncompleteToolCalls: true,
        }
      );
    } catch (error: unknown) {
      throw new Error(`Failed to convert UI messages: ${getErrorMessage(error)}`);
    }
  }

  return messages as ChatInputMessage[];
};

export const toLlmChatMessages = (messages: ChatInputMessage[]): LlmChatMessage[] =>
  messages
    .filter(
      (message): message is Extract<ChatInputMessage, { role: 'system' | 'user' | 'assistant' }> =>
        message.role === 'system' || message.role === 'user' || message.role === 'assistant'
    )
    .map(message => ({
      role: message.role,
      content: extractTextFromModelMessageContent(message.content),
    }))
    .filter(message => message.role === 'system' || message.content.length > 0);

export const getPromptFromMessage = (message: ChatInputMessage | undefined): string => {
  if (!message || message.role !== 'user') return '';
  return extractTextFromModelMessageContent(message.content);
};
