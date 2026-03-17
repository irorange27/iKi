import {
  convertToModelMessages,
  validateUIMessages,
  type UIMessageChunk,
} from 'ai';

import type { AgentMessage } from '../../../core/agent';
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

export const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const createRuntimeId = (prefix: string) =>
  `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

const DYNAMIC_TOOL_STATES = new Set([
  'input-streaming',
  'input-available',
  'approval-requested',
  'approval-responded',
  'output-available',
  'output-error',
  'output-denied',
]);

const getNestedToolEventField = (event: ToolStreamEvent, field: 'toolCallId' | 'toolName'): unknown => {
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

const getApprovalIdFromPart = (part: Record<string, unknown>, fallbackId: string): string => {
  if (typeof part.approvalId === 'string' && part.approvalId.length > 0) return part.approvalId;
  if (isObjectRecord(part.approval) && typeof part.approval.id === 'string' && part.approval.id) {
    return part.approval.id;
  }
  return fallbackId;
};

const getErrorTextFromToolPart = (part: Record<string, unknown>): string => {
  if (typeof part.errorText === 'string' && part.errorText.trim()) return part.errorText;
  if (typeof part.output === 'string' && part.output.trim()) return part.output;
  if (isObjectRecord(part.output)) {
    if (typeof part.output.error === 'string' && part.output.error.trim()) return part.output.error;
    if (typeof part.output.message === 'string' && part.output.message.trim()) {
      return part.output.message;
    }
  }
  return 'Tool execution failed';
};

const getDeniedReasonFromToolPart = (part: Record<string, unknown>): string | undefined => {
  if (isObjectRecord(part.approval) && typeof part.approval.reason === 'string') {
    return part.approval.reason;
  }
  if (typeof part.output === 'string' && part.output.trim()) return part.output;
  if (isObjectRecord(part.output) && typeof part.output.message === 'string') {
    return part.output.message;
  }
  return undefined;
};

const normalizeDynamicToolPart = (
  part: Record<string, unknown>,
  fallbackToolCallId: string
): Record<string, unknown> => {
  const toolCallId =
    typeof part.toolCallId === 'string' && part.toolCallId.length > 0
      ? part.toolCallId
      : fallbackToolCallId;
  const toolName =
    typeof part.toolName === 'string' && part.toolName.length > 0 ? part.toolName : 'tool';

  const rawState = typeof part.state === 'string' ? part.state : 'input-available';
  const state = DYNAMIC_TOOL_STATES.has(rawState) ? rawState : 'input-available';
  const input = part.input ?? {};

  const normalizedBase: Record<string, unknown> = {
    type: 'dynamic-tool',
    toolCallId,
    toolName,
  };

  if (typeof part.title === 'string' && part.title.trim()) {
    normalizedBase.title = part.title;
  }
  if (typeof part.providerExecuted === 'boolean') {
    normalizedBase.providerExecuted = part.providerExecuted;
  }
  if (isObjectRecord(part.callProviderMetadata)) {
    normalizedBase.callProviderMetadata = part.callProviderMetadata;
  }

  if (state === 'input-streaming') {
    return { ...normalizedBase, state, input };
  }
  if (state === 'input-available') {
    return { ...normalizedBase, state, input };
  }
  if (state === 'approval-requested') {
    return {
      ...normalizedBase,
      state,
      input,
      approval: {
        id: getApprovalIdFromPart(part, `${toolCallId}_approval`),
      },
    };
  }
  if (state === 'approval-responded') {
    const approved =
      isObjectRecord(part.approval) && typeof part.approval.approved === 'boolean'
        ? part.approval.approved
        : false;
    const reason =
      isObjectRecord(part.approval) && typeof part.approval.reason === 'string'
        ? part.approval.reason
        : undefined;

    return {
      ...normalizedBase,
      state,
      input,
      approval: {
        id: getApprovalIdFromPart(part, `${toolCallId}_approval`),
        approved,
        ...(typeof reason === 'string' && reason.length > 0 ? { reason } : {}),
      },
    };
  }
  if (state === 'output-available') {
    const approval =
      isObjectRecord(part.approval) &&
      typeof part.approval.id === 'string' &&
      part.approval.approved === true
        ? {
            id: part.approval.id,
            approved: true as const,
            ...(typeof part.approval.reason === 'string' && part.approval.reason.length > 0
              ? { reason: part.approval.reason }
              : {}),
          }
        : undefined;

    return {
      ...normalizedBase,
      state,
      input,
      output: part.output ?? null,
      ...(typeof part.preliminary === 'boolean' ? { preliminary: part.preliminary } : {}),
      ...(approval ? { approval } : {}),
    };
  }
  if (state === 'output-error') {
    return {
      ...normalizedBase,
      state,
      input,
      errorText: getErrorTextFromToolPart(part),
    };
  }

  const deniedReason = getDeniedReasonFromToolPart(part);
  return {
    ...normalizedBase,
    state: 'output-denied',
    input,
    approval: {
      id: getApprovalIdFromPart(part, `${toolCallId}_approval`),
      approved: false,
      ...(typeof deniedReason === 'string' && deniedReason.length > 0
        ? { reason: deniedReason }
        : {}),
    },
  };
};

const normalizeUiMessagesForValidation = (messages: ChatUiMessage[]): ChatUiMessage[] =>
  messages.map((message, messageIndex) => {
    const messageId =
      typeof message.id === 'string' && message.id.length > 0
        ? message.id
        : createRuntimeId(`ui_msg_${messageIndex}`);

    const role =
      message.role === 'system' || message.role === 'user' || message.role === 'assistant'
        ? message.role
        : 'user';

    const parts = Array.isArray(message.parts)
      ? message.parts
          .map((part, partIndex) => {
            if (!isObjectRecord(part) || typeof part.type !== 'string') return null;
            if (part.type === 'dynamic-tool') {
              return normalizeDynamicToolPart(part, `${messageId}_tool_${partIndex}`);
            }
            if (part.type === 'memory-retrieval') {
              return null;
            }
            return part;
          })
          .filter((part): part is Exclude<typeof part, null> => part !== null)
      : [];

    return {
      id: messageId,
      role,
      ...(message.metadata !== undefined ? { metadata: message.metadata } : {}),
      parts: parts as ChatUiMessage['parts'],
    };
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
          delete normalized.startedAt;
          delete normalized.endedAt;
          delete normalized.durationMs;
          delete normalized.inputText;
          delete normalized.collapsed;
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

const normalizeUiRole = (value: unknown): 'system' | 'user' | 'assistant' => {
  if (value === 'system' || value === 'user' || value === 'assistant') return value;
  return 'user';
};

export const parseStoredUiMessageRow = (row: { id: string; message: string }): ChatUiMessage => {
  try {
    const parsed = JSON.parse(row.message);
    if (isObjectRecord(parsed)) {
      if (Array.isArray(parsed.parts)) {
        const parts = parsed.parts.filter(
          part => isObjectRecord(part) && typeof part.type === 'string'
        ) as ChatUiMessage['parts'];
        return {
          id: row.id,
          role: normalizeUiRole(parsed.role),
          parts: parts.length > 0 ? parts : ([{ type: 'text', text: '' }] as any),
        };
      }

      if (typeof parsed.content === 'string') {
        return {
          id: row.id,
          role: normalizeUiRole(parsed.role),
          parts: [{ type: 'text', text: parsed.content }] as any,
        };
      }
    }
  } catch {
    // fall through
  }

  return {
    id: row.id,
    role: 'user',
    parts: [{ type: 'text', text: row.message }] as any,
  };
};

const toUiChunkFromToolEvent = (event: ToolStreamEvent): UIMessageChunk | null => {
  const toolCallId = getToolCallIdFromEvent(event);
  const toolName = getToolNameFromEvent(event);

  if (event.type === 'tool-input-start') {
    return {
      type: 'tool-input-start',
      toolCallId,
      toolName,
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
        dynamic: true,
      };
    }
    return {
      type: 'tool-input-available',
      toolCallId,
      toolName,
      input: event.input ?? {},
      dynamic: true,
    };
  }
  if (event.type === 'tool-result') {
    return {
      type: 'tool-output-available',
      toolCallId,
      output: event.output,
      dynamic: true,
      ...(typeof event.preliminary === 'boolean' ? { preliminary: event.preliminary } : {}),
    };
  }
  if (event.type === 'tool-error') {
    return {
      type: 'tool-output-error',
      toolCallId,
      errorText:
        typeof event.error === 'string'
          ? event.error
          : event.error instanceof Error
            ? event.error.message
            : 'Tool execution failed',
      dynamic: true,
    };
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

  const emitChunk = (chunk: UIMessageChunk) => {
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

    try {
      await validateUIMessages({
        messages: normalizedUiMessages,
      });
    } catch (error: unknown) {
      throw new Error(`Invalid UI messages: ${getErrorMessage(error)}`);
    }

    try {
      return await convertToModelMessages(
        normalizedUiMessages.map(({ id, ...message }) => message),
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

const extractTextFromContent = (content: unknown): string => {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';

  return content
    .filter(
      part =>
        isObjectRecord(part) &&
        part.type === 'text' &&
        typeof part.text === 'string' &&
        part.text.length > 0
    )
    .map(part => String((part as { text: string }).text))
    .join('');
};

export const toLlmChatMessages = (messages: ChatInputMessage[]): LlmChatMessage[] =>
  messages
    .filter(
      (message): message is Extract<ChatInputMessage, { role: 'system' | 'user' | 'assistant' }> =>
        message.role === 'system' || message.role === 'user' || message.role === 'assistant'
    )
    .map(message => ({
      role: message.role,
      content: extractTextFromContent(message.content),
    }))
    .filter(message => message.role === 'system' || message.content.length > 0);

export const toAgentMessages = (messages: ChatInputMessage[]): AgentMessage[] => {
  const agentMessages: AgentMessage[] = [];

  for (const message of messages) {
    const timestamp = new Date().toISOString();

    if (message.role === 'system' || message.role === 'user') {
      agentMessages.push({
        role: message.role,
        content: extractTextFromContent(message.content),
        timestamp,
      });
      continue;
    }

    if (message.role === 'assistant') {
      const textContent = extractTextFromContent(message.content);
      const metadata: Record<string, unknown> = {};

      if (Array.isArray(message.content)) {
        const assistantParts = message.content as unknown[];
        const toolCalls = assistantParts.filter(
          part => isObjectRecord(part) && part.type === 'tool-call'
        );
        const toolApprovalRequests = assistantParts.filter(
          part => isObjectRecord(part) && part.type === 'tool-approval-request'
        );

        if (toolCalls.length > 0) {
          metadata.toolCalls = toolCalls;
        }
        if (toolApprovalRequests.length > 0) {
          metadata.toolApprovalRequests = toolApprovalRequests;
        }
      }

      if (!textContent && Object.keys(metadata).length === 0) {
        continue;
      }

      agentMessages.push({
        role: 'assistant',
        content: textContent,
        timestamp,
        ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
      });
      continue;
    }

    if (message.role === 'tool') {
      if (!Array.isArray(message.content)) {
        agentMessages.push({
          role: 'tool',
          content:
            typeof message.content === 'string'
              ? message.content
              : JSON.stringify(message.content ?? {}),
          timestamp,
        });
        continue;
      }

      const toolParts = message.content as unknown[];
      for (const part of toolParts) {
        if (!isObjectRecord(part) || typeof part.type !== 'string') continue;
        const partType = part.type;

        if (partType === 'tool-result') {
          const resultPart = part as {
            output?: unknown;
            toolCallId?: unknown;
            toolName?: unknown;
          };
          agentMessages.push({
            role: 'tool',
            content: JSON.stringify(resultPart.output ?? {}),
            timestamp,
            metadata: {
              toolCallId: resultPart.toolCallId,
              toolName: resultPart.toolName,
            },
          });
          continue;
        }

        if (partType === 'tool-approval-response') {
          const approvalPart = part as {
            approvalId?: unknown;
            approved?: unknown;
            reason?: unknown;
          };
          agentMessages.push({
            role: 'tool',
            content: JSON.stringify({
              approvalId: approvalPart.approvalId,
              approved: approvalPart.approved,
              reason: approvalPart.reason,
            }),
            timestamp,
            metadata: {
              approvalId: approvalPart.approvalId,
            },
          });
        }
      }
    }
  }

  return agentMessages;
};

export const getPromptFromMessage = (message: ChatInputMessage | undefined): string => {
  if (!message || message.role !== 'user') return '';
  return extractTextFromContent(message.content);
};
