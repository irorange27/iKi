import { app, BrowserWindow, ipcMain, shell } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';
import started from 'electron-squirrel-startup';
import {
  convertToModelMessages,
  validateUIMessages,
  type ModelMessage,
  type ToolApprovalResponse,
  type UIMessage,
  type UIMessageChunk,
} from 'ai';
import { getConfig, setConfig, migrateFromJson } from './core/db/database';
import * as providerDb from './core/db/providers';
import * as chatThreadDb from './core/db/chat_thread';
import * as chatMessageDb from './core/db/chat_message';
import * as memoryDb from './core/db/memory';
import * as workspaceDb from './core/db/workspaces';
import * as promptAppDb from './core/db/prompt_apps';
import { getToolModel, generateTitleWithAgent } from './core/provider/tool_model';
import { analyzeEmotionWithAgent } from './core/provider/emotion_model';
import { selectToolsWithAgent } from './core/provider/tool_selection';
import { selectSkillsWithAgent } from './core/provider/skill_selection';
import { generateLongMemorySummary } from './core/memory/auto_summarize';
import { registerStandardTools, defaultToolRegistry } from './core/tools';
import {
  buildSkillsSystemPrompt,
  getSkillFolderPath,
  getSkillRootsForUi,
  listSkills,
  normalizeSkillIds,
  readSkillContent,
} from './core/skills';
import { SimpleAgent } from './core/agent';
import type { AppConfig } from './shared/types/config';
import type { AgentMessage, AgentResult } from './core/agent';

const getRendererDevServerUrl = () => process.env.MAIN_WINDOW_VITE_DEV_SERVER_URL || 'http://localhost:5173';

const getRendererProdHtmlPath = () => path.join(__dirname, '../renderer/main_window/index.html');

const getErrorMessage = (error: unknown) => {
  if (error instanceof Error) return error.message;
  return String(error);
};

const shouldLogChunk = (count: number) => count <= 3 || count % 20 === 0;

const TOOL_AGENT_SYSTEM_PROMPT =
  'You can use tools (filesystem, shell, web) when they are necessary to solve the task.\n' +
  'Rules:\n' +
  '- Prefer answering directly when tools are not needed.\n' +
  '- Use the minimal number of tool calls needed for correctness.\n' +
  '- For each tool call, include a `description` field in the tool arguments: one short sentence explaining why you are calling the tool.\n' +
  '- Be conservative with destructive actions (writing/deleting files, risky shell commands).\n' +
  '- When using file paths, stay within the workspace.\n';

type ChatWebContents = {
  id: number;
  send: (channel: string, ...args: unknown[]) => void;
};

type ChatInputMessage = ModelMessage;
type ChatUiMessage = UIMessage;
type ChatTransportMessage = ChatInputMessage | ChatUiMessage;

type LlmChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

type ActiveStreamState = {
  cancelled: boolean;
  stoppedByUser: boolean;
  abortController: AbortController;
};

type ToolStreamEvent = {
  type: string;
  [key: string]: unknown;
};

type UiChunkEmitter = {
  messageId: string;
  emitTextDelta: (delta: string) => void;
  emitToolEvent: (event: ToolStreamEvent) => void;
  finish: () => void;
  abort: () => void;
  error: (errorText: string) => void;
};

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
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

const sanitizeUiMessageJsonForStorage = (raw: string): string => {
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

const parseStoredUiMessageRow = (row: { id: string; message: string }): ChatUiMessage => {
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

const createUiChunkEmitter = (
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

const toModelInputMessages = async (
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

const toLlmChatMessages = (messages: ChatInputMessage[]): LlmChatMessage[] =>
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

const toAgentMessages = (messages: ChatInputMessage[]): AgentMessage[] => {
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

const getPromptFromMessage = (message: ChatInputMessage | undefined): string => {
  if (!message || message.role !== 'user') return '';
  return extractTextFromContent(message.content);
};

const getMemoryConfig = () => {
  const appConfig = getConfig('app_config') as AppConfig | null;
  return appConfig?.memory || null;
};

const memorySummarizeInFlight = new Set<string>();

const shouldAutoSummarizeThread = (threadId: string): boolean => {
  const memoryConfig = getMemoryConfig();
  if (!memoryConfig?.autoSummarize) return false;
  const thread = chatThreadDb.getChatThread(threadId);
  if (thread?.is_incognito) return false;
  return true;
};

const wasMessageSummarized = (threadId: string, messageId: string): boolean => {
  if (!threadId || !messageId) return false;
  const recent = memoryDb.listLongMemory(threadId, 25);
  for (const entry of recent) {
    if (!entry.source_message_ids) continue;
    try {
      const parsed = JSON.parse(entry.source_message_ids);
      if (Array.isArray(parsed) && parsed.includes(messageId)) {
        return true;
      }
    } catch {
      continue;
    }
  }
  return false;
};

const maybeAutoSummarizeLongMemory = async (
  threadId: string,
  messageId: string,
  messageJson?: string
): Promise<void> => {
  if (!threadId || !messageId || typeof messageJson !== 'string') return;
  if (!shouldAutoSummarizeThread(threadId)) return;

  const extracted = memoryDb.extractTextFromMessageJson(messageJson);
  if (!extracted || extracted.role !== 'assistant') return;
  if (!extracted.content || !extracted.content.trim()) return;

  if (wasMessageSummarized(threadId, messageId)) return;
  if (memorySummarizeInFlight.has(threadId)) return;
  memorySummarizeInFlight.add(threadId);

  try {
    const shortEntries = memoryDb.listShortMemory(threadId, 50);
    const summary = await generateLongMemorySummary(shortEntries);
    if (!summary) return;

    const normalizedSummary = summary.summary.trim().toLowerCase();
    const recentLong = memoryDb.listLongMemory(threadId, 10);
    if (
      recentLong.some(
        entry => entry.summary && entry.summary.trim().toLowerCase() === normalizedSummary
      )
    ) {
      return;
    }

    memoryDb.addLongMemory(
      {
        thread_id: threadId,
        summary: summary.summary,
        source_message_ids: summary.sourceMessageIds,
        metadata: {
          source: 'auto',
          model: summary.model,
          messageIds: summary.sourceMessageIds,
        },
      },
      { force: true }
    );
  } finally {
    memorySummarizeInFlight.delete(threadId);
  }
};

const queueEmotionAnalysis = (params: {
  threadId: string;
  messageId: string;
  messageJson: string;
}) => {
  const memoryConfig = getMemoryConfig();
  if (!memoryConfig?.enabled) return;

  const extracted = memoryDb.extractTextFromMessageJson(params.messageJson);
  if (!extracted || extracted.role !== 'user') return;

  const content = extracted.content.trim();
  if (!content) return;

  void (async () => {
    try {
      const emotion = await analyzeEmotionWithAgent(content);
      if (!emotion) return;
      memoryDb.addShortMemory({
        thread_id: params.threadId,
        message_id: params.messageId,
        role: extracted.role,
        content: extracted.content,
        emotion,
      });
    } catch (error) {
      console.warn(
        `[Emotion][Main] analysis failed message=${params.messageId}:`,
        getErrorMessage(error)
      );
    }
  })();
};

const formatMemoryLine = (entry: { summary: string; score: number; updated_at?: string }) => {
  const score = Number.isFinite(entry.score) ? entry.score.toFixed(3) : '0.000';
  const dateText = entry.updated_at ? new Date(entry.updated_at).toLocaleDateString() : '';
  const summary = entry.summary.trim().replace(/\s+/g, ' ');
  return dateText ? `- (${score}, ${dateText}) ${summary}` : `- (${score}) ${summary}`;
};

const buildMemorySystemMessage = (
  entries: Array<{ summary: string; score: number; updated_at?: string }>
): string => {
  if (!entries.length) return '';
  const lines = entries.map(formatMemoryLine);
  return [
    'Long-term memory (use only if relevant; ignore if unrelated):',
    ...lines,
  ].join('\n');
};

const injectMemoryIntoMessages = (
  messages: ChatInputMessage[],
  threadId?: string
): ChatInputMessage[] => {
  if (!threadId) return messages;
  const memoryConfig = getMemoryConfig();
  if (!memoryConfig?.enabled) return messages;

  const lastMessage = messages[messages.length - 1];
  const query = getPromptFromMessage(lastMessage);
  if (!query.trim()) return messages;

  const results = memoryDb.searchLongMemory(threadId, query, {
    limit: memoryConfig.maxRetrievalCount,
    threshold: memoryConfig.similarThreshold,
  });

  if (!results.length) return messages;
  const systemContent = buildMemorySystemMessage(results);
  if (!systemContent.trim()) return messages;

  const insertIndex = messages.findIndex(message => message.role !== 'system');
  const headIndex = insertIndex === -1 ? messages.length : insertIndex;
  const memoryMessage: ChatInputMessage = {
    role: 'system',
    content: systemContent,
  };

  return [
    ...messages.slice(0, headIndex),
    memoryMessage,
    ...messages.slice(headIndex),
  ];
};

const pendingApprovalSessions = new Map<
  string,
  PendingApprovalSession
>();

type PendingApprovalSession = {
  agent: SimpleAgent;
  webContents: ChatWebContents;
  pendingApprovalIds: Set<string>;
  collectedApprovalResponses: Map<string, ToolApprovalResponse>;
};

const ensurePendingApprovalSession = (
  approvalId: string,
  session: {
    agent: SimpleAgent;
    webContents: ChatWebContents;
  }
) => {
  const existing = pendingApprovalSessions.get(approvalId);
  if (existing) return existing;

  const created: PendingApprovalSession = {
    agent: session.agent,
    webContents: session.webContents,
    pendingApprovalIds: new Set([approvalId]),
    collectedApprovalResponses: new Map(),
  };
  pendingApprovalSessions.set(approvalId, created);
  return created;
};

const registerApprovalBatch = (
  approvalRequests: Array<{ approvalId: string }>,
  session: {
    agent: SimpleAgent;
    webContents: ChatWebContents;
  }
) => {
  const approvalIds = approvalRequests
    .map(request => request.approvalId)
    .filter(id => typeof id === 'string' && id.length > 0);

  if (approvalIds.length === 0) return;

  const pendingSession: PendingApprovalSession = {
    agent: session.agent,
    webContents: session.webContents,
    pendingApprovalIds: new Set(approvalIds),
    collectedApprovalResponses: new Map(),
  };

  for (const approvalId of approvalIds) {
    pendingApprovalSessions.set(approvalId, pendingSession);
  }
};

const getPendingApprovalIdsFromUiMessage = (message: ChatUiMessage): string[] => {
  const parts = Array.isArray(message.parts) ? (message.parts as unknown[]) : [];
  const ids: string[] = [];

  for (const part of parts) {
    if (!isObjectRecord(part)) continue;
    if (part.type !== 'dynamic-tool') continue;
    if (part.state !== 'approval-requested') continue;

    const approvalId =
      typeof part.approvalId === 'string'
        ? part.approvalId
        : isObjectRecord(part.approval) && typeof part.approval.id === 'string'
          ? part.approval.id
          : '';

    if (approvalId) ids.push(approvalId);
  }

  return ids;
};

const getToolNameForApproval = (message: ChatUiMessage, approvalId: string): string | null => {
  const parts = Array.isArray(message.parts) ? (message.parts as unknown[]) : [];
  for (const part of parts) {
    if (!isObjectRecord(part)) continue;
    if (part.type !== 'dynamic-tool') continue;
    if (part.state !== 'approval-requested') continue;

    const partApprovalId =
      typeof part.approvalId === 'string'
        ? part.approvalId
        : isObjectRecord(part.approval) && typeof part.approval.id === 'string'
          ? part.approval.id
          : '';

    if (partApprovalId !== approvalId) continue;
    if (typeof part.toolName === 'string' && part.toolName.trim()) {
      return part.toolName.trim();
    }
  }
  return null;
};

const tryRecoverApprovalSession = async (
  approvalId: string,
  webContents: ChatWebContents
): Promise<PendingApprovalSession | null> => {
  if (!approvalId || typeof approvalId !== 'string') return null;
  const needle = approvalId.trim();
  if (!needle) return null;

  // 1) Find a message that contains this approval id and is still pending.
  const candidates = chatMessageDb.findChatMessagesByMessageSubstring(needle, 50);
  const match = candidates.find(row => {
    const ui = parseStoredUiMessageRow({ id: row.id, message: row.message });
    return getPendingApprovalIdsFromUiMessage(ui).includes(needle);
  });

  if (!match) return null;

  const threadId = typeof match.thread_id === 'string' ? match.thread_id : '';
  if (!threadId) return null;

  // 2) Load thread context (provider/model/tools/skills)
  const thread = chatThreadDb.getChatThread(threadId);
  if (!thread) return null;

  let providerType = '';
  let model = '';
  try {
    const meta = thread.metadata ? JSON.parse(thread.metadata) : {};
    if (isObjectRecord(meta) && isObjectRecord(meta.llm)) {
      if (typeof meta.llm.providerType === 'string') providerType = meta.llm.providerType;
      if (typeof meta.llm.model === 'string') model = meta.llm.model;
    }
  } catch {
    // ignore
  }

  if (!model && typeof thread.model === 'string') {
    model = thread.model;
  }

  // providerType is mandatory for rebuilding the agent; without it we cannot reliably resume.
  if (!providerType || !model) {
    console.warn('[Main] Cannot recover approval session: missing providerType/model', {
      threadId,
      providerType,
      model,
    });
    return null;
  }

  let toolNames: string[] = [];
  if (thread.tools) {
    try {
      const parsed = JSON.parse(thread.tools);
      if (Array.isArray(parsed)) {
        toolNames = parsed.filter((t): t is string => typeof t === 'string' && t.trim().length > 0);
      }
    } catch {
      toolNames = [];
    }
  }

  // 3) Rebuild tool list if thread.tools was not persisted (older threads).
  if (toolNames.length === 0) {
    const toolName = getToolNameForApproval(
      parseStoredUiMessageRow({ id: match.id, message: match.message }),
      needle
    );
    if (toolName) toolNames = [toolName];
  }

  // 4) Load UI messages from DB and convert them back to model messages (AI SDK boundary).
  const rows = chatMessageDb.getChatMessages(threadId);
  const uiMessages = rows.map(row => parseStoredUiMessageRow({ id: row.id, message: row.message }));
  const inputMessages = injectMemoryIntoMessages(await toModelInputMessages(uiMessages), threadId);

  // 5) Rebuild agent + pending approval batch.
  let normalizedSkillIds: string[] = [];
  try {
    if (thread.skill_ids) {
      normalizedSkillIds = normalizeSkillIds(JSON.parse(thread.skill_ids));
    }
  } catch {
    normalizedSkillIds = [];
  }
  const skillsSystemPrompt =
    normalizedSkillIds.length > 0 ? await buildSkillsSystemPrompt(normalizedSkillIds) : '';

  const agent = new SimpleAgent({
    enabled: true,
    providerType,
    model,
    systemPrompt: [TOOL_AGENT_SYSTEM_PROMPT, skillsSystemPrompt].filter(Boolean).join('\n\n'),
    enableTools: true,
    maxIterations: 5,
  });

  for (const name of toolNames) {
    const tool = defaultToolRegistry.get(name);
    if (tool) agent.registerTool(tool);
  }

  agent.setMessages(toAgentMessages(inputMessages));

  const pendingApprovalIds = new Set<string>();
  for (const ui of uiMessages) {
    for (const id of getPendingApprovalIdsFromUiMessage(ui)) {
      pendingApprovalIds.add(id);
    }
  }

  if (pendingApprovalIds.size === 0) {
    return null;
  }

  const session: PendingApprovalSession = {
    agent,
    webContents,
    pendingApprovalIds,
    collectedApprovalResponses: new Map(),
  };

  for (const id of pendingApprovalIds) {
    pendingApprovalSessions.set(id, session);
  }

  return session;
};

const activeStreams = new Map<number, ActiveStreamState>();

const streamAgentResponse = async (
  agent: SimpleAgent,
  webContents: ChatWebContents,
  prompt: string,
  approvalResponses?: ToolApprovalResponse[],
  shouldCancel?: () => boolean,
  debugLabel?: string,
  onToolEvent?: (event: ToolStreamEvent) => void,
  abortSignal?: AbortSignal,
  uiChunkEmitter?: UiChunkEmitter
) => {
  const generator = agent.stream(prompt, approvalResponses, onToolEvent, abortSignal);
  let fullResponse = '';
  let chunkCount = 0;
  let chunkChars = 0;
  const startedAt = Date.now();
  let cancelled = false;
  let next: IteratorResult<string, AgentResult> | null = null;

  try {
    next = await generator.next();
    while (!next.done) {
      if (shouldCancel?.()) {
        cancelled = true;
        try {
          await generator.return(undefined);
        } catch (error) {
          console.warn('[Main] Failed to close cancelled tool stream:', error);
        }
        break;
      }

      const chunk = next.value;
      if (typeof chunk === 'string' && chunk) {
        chunkCount += 1;
        chunkChars += chunk.length;
        if (debugLabel && shouldLogChunk(chunkCount)) {
          console.log(
            `[StreamDebug][Main][Agent][${debugLabel}] chunk#${chunkCount} len=${chunk.length} totalChars=${chunkChars}`
          );
        }
        fullResponse += chunk;
        uiChunkEmitter?.emitTextDelta(chunk);
      }
      next = await generator.next();
    }
  } catch (error) {
    if (shouldCancel?.() || (error instanceof Error && error.name === 'AbortError')) {
      cancelled = true;
      try {
        await generator.return(undefined);
      } catch (returnError) {
        console.warn('[Main] Failed to close aborted tool stream:', returnError);
      }
    } else {
      uiChunkEmitter?.error(getErrorMessage(error));
      throw error;
    }
  }

  if (cancelled || !next) {
    if (debugLabel) {
      console.log(
        `[StreamDebug][Main][Agent][${debugLabel}] cancelled chunkCount=${chunkCount} totalChars=${chunkChars} durationMs=${Date.now() - startedAt}`
      );
    }
    uiChunkEmitter?.abort();
    return { awaitingApproval: false, cancelled: true };
  }

  const agentResult = (next.value ?? null) as AgentResult | null;
  let finalText = fullResponse;
  if (agentResult?.response && agentResult.response.trim()) {
    finalText = agentResult.response;
  }

  if (agentResult?.toolApprovalRequests && agentResult.toolApprovalRequests.length > 0) {
    registerApprovalBatch(agentResult.toolApprovalRequests, { agent, webContents });
    return { awaitingApproval: true };
  }

  if (!finalText.trim() && fullResponse.trim()) {
    finalText = fullResponse;
  }

  if (debugLabel) {
    console.log(
      `[StreamDebug][Main][Agent][${debugLabel}] done chunkCount=${chunkCount} totalChars=${chunkChars} finalTextLen=${(finalText || '').length} durationMs=${Date.now() - startedAt}`
    );
  }
  uiChunkEmitter?.finish();
  return { awaitingApproval: false };
};

// Register standard tools on startup
registerStandardTools();

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

// Config Management
const userDataPath = app.getPath('userData');
const configPath = path.join(userDataPath, 'app-config.json');

// Run migration if old config exists
migrateFromJson(configPath, 'app_config');

const loadConfig = () => {
  return getConfig('app_config') || {};
};

const saveConfig = (config: unknown) => {
  setConfig('app_config', config);
};

ipcMain.handle('config:get', () => {
  return loadConfig();
});

ipcMain.handle('config:set', (event, config) => {
  saveConfig(config);

  const windows = BrowserWindow.getAllWindows();

  windows.forEach(win => {
    win.webContents.send('config:updated', config);
  });
  return true;
});

// Provider Management
ipcMain.handle('providers:list', () => {
  const providers = providerDb.getProviders();
  console.log('[Main] providers:list returned:', providers.length, 'providers');
  return providers;
});
ipcMain.handle('providers:get', (_, id) => providerDb.getProvider(id));
ipcMain.handle('providers:add', (_, provider) => {
  console.log('[Main] providers:add called with:', provider);
  try {
    const result = providerDb.addProvider(provider);
    console.log('[Main] providers:add result:', result);
    return result;
  } catch (error) {
    console.error('[Main] providers:add error:', error);
    throw error;
  }
});
ipcMain.handle('providers:update', (_, id, provider) => {
  console.log('[Main] providers:update called with id:', id, 'data:', provider);
  try {
    const result = providerDb.updateProvider(id, provider);
    console.log('[Main] providers:update result:', result);
    return result;
  } catch (error) {
    console.error('[Main] providers:update error:', error);
    throw error;
  }
});
ipcMain.handle('providers:delete', (_, id) => providerDb.deleteProvider(id));

// Chat Thread Management
ipcMain.handle('chat:threads:list', () => chatThreadDb.getChatThreads());
ipcMain.handle('chat:threads:get', (_, id) => chatThreadDb.getChatThread(id));
ipcMain.handle('chat:threads:create', (_, thread) => {
  const threadId = thread.id || `thread_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const title = thread.title || 'New Chat';
  chatThreadDb.addChatThread({
    id: threadId,
    title,
    model: thread.model || null,
    metadata: thread.metadata || '{}',
    is_generating: false,
  });
  // Return the created thread
  return chatThreadDb.getChatThread(threadId);
});
ipcMain.handle('chat:threads:update', (_, id, thread) => chatThreadDb.updateChatThread(id, thread));
ipcMain.handle('chat:threads:delete', (_, id) => chatThreadDb.deleteChatThread(id));

// Chat Message Management
ipcMain.handle('chat:messages:list', (_, threadId) => chatMessageDb.getChatMessages(threadId));
ipcMain.handle('chat:messages:get', (_, id) => chatMessageDb.getChatMessage(id));
ipcMain.handle('chat:messages:create', (_, message) => {
  const messageId = message.id || `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const timestamp = message.timestamp || new Date().toISOString();
  const sanitizedMessageJson =
    typeof message.message === 'string'
      ? sanitizeUiMessageJsonForStorage(message.message)
      : JSON.stringify(message.message ?? {});
  console.log(
    `[ChatPersist][Main] create-request id=${messageId} thread=${message.thread_id} parent=${message.parent_id || 'null'} depth=${message.depth || 0}`
  );

  try {
    chatMessageDb.addChatMessage({
      id: messageId,
      thread_id: message.thread_id,
      parent_id: message.parent_id || null,
      slot_id: message.slot_id || null,
      depth: message.depth || 0,
      message: sanitizedMessageJson,
      timestamp,
      metadata: message.metadata || '{}',
    });
  } catch (error: unknown) {
    const errorCode =
      typeof error === 'object' && error !== null && 'code' in error
        ? String((error as { code?: unknown }).code)
        : '';
    const errorMessage = getErrorMessage(error);

    if (
      errorCode === 'SQLITE_CONSTRAINT_PRIMARYKEY' ||
      errorMessage.includes('UNIQUE constraint failed: chat_messages.id')
    ) {
      console.warn(
        `[ChatPersist][Main] duplicate-create id=${messageId} thread=${message.thread_id} parent=${message.parent_id || 'null'}`
      );
      const existing = chatMessageDb.getChatMessage(messageId);
      if (existing) return existing;
    }

    console.error(
      `[ChatPersist][Main] create-failed id=${messageId} thread=${message.thread_id} code=${errorCode || 'unknown'} error=${errorMessage}`
    );
    throw error;
  }

  try {
    if (typeof sanitizedMessageJson === 'string') {
      const memoryConfig = getMemoryConfig();
      const forceShortMemory = Boolean(memoryConfig?.autoSummarize);
      memoryDb.addShortMemoryFromChatMessage({
        thread_id: message.thread_id,
        message_id: messageId,
        message_json: sanitizedMessageJson,
      }, forceShortMemory ? { force: true } : undefined);
      memoryDb.pruneShortMemory(message.thread_id);
      queueEmotionAnalysis({
        threadId: message.thread_id,
        messageId,
        messageJson: sanitizedMessageJson,
      });
      void maybeAutoSummarizeLongMemory(message.thread_id, messageId, sanitizedMessageJson);
    }
  } catch (error) {
    console.warn('[Memory][Main] short memory insert failed:', getErrorMessage(error));
  }

  const created = chatMessageDb.getChatMessage(messageId);
  console.log(
    `[ChatPersist][Main] create-success id=${messageId} thread=${message.thread_id} parent=${message.parent_id || 'null'}`
  );
  return created;
});
ipcMain.handle('chat:messages:update', (_, id, message) => {
  const sanitizedUpdate =
    message && typeof message === 'object' && message !== null
      ? {
          ...message,
          ...(typeof (message as { message?: unknown }).message === 'string'
            ? { message: sanitizeUiMessageJsonForStorage((message as { message: string }).message) }
            : {}),
        }
      : message;

  const result = chatMessageDb.updateChatMessage(id, sanitizedUpdate);
  try {
    const existing = chatMessageDb.getChatMessage(id);
    const threadId = sanitizedUpdate.thread_id || existing?.thread_id;
    const messageJson =
      typeof sanitizedUpdate.message === 'string' ? sanitizedUpdate.message : existing?.message;
    if (threadId && messageJson) {
      const memoryConfig = getMemoryConfig();
      const forceShortMemory = Boolean(memoryConfig?.autoSummarize);
      memoryDb.addShortMemoryFromChatMessage({
        thread_id: threadId,
        message_id: id,
        message_json: messageJson,
      }, forceShortMemory ? { force: true } : undefined);
      memoryDb.pruneShortMemory(threadId);
      queueEmotionAnalysis({
        threadId,
        messageId: id,
        messageJson,
      });
      void maybeAutoSummarizeLongMemory(threadId, id, messageJson);
    }
  } catch (error) {
    console.warn('[Memory][Main] short memory update failed:', getErrorMessage(error));
  }
  return result;
});
ipcMain.handle('chat:messages:delete', (_, id) => chatMessageDb.deleteChatMessage(id));

// Memory Management
ipcMain.handle('memory:short:list', (_, threadId, limit) =>
  memoryDb.listShortMemory(threadId, limit)
);
ipcMain.handle('memory:short:add', (_, entry) => memoryDb.addShortMemory(entry));
ipcMain.handle('memory:long:add', (_, entry) => memoryDb.addLongMemory(entry));
ipcMain.handle('memory:long:list', (_, threadId, limit) =>
  memoryDb.listLongMemory(threadId, limit)
);
ipcMain.handle('memory:long:search', (_, threadId, query, options) =>
  memoryDb.searchLongMemory(threadId, query, options)
);

// Workspace Management
ipcMain.handle('workspaces:list', () => workspaceDb.getWorkspaces());
ipcMain.handle('workspaces:get', (_, id) => workspaceDb.getWorkspace(id));
ipcMain.handle('workspaces:getByPath', (_, path) => workspaceDb.getWorkspaceByPath(path));
ipcMain.handle('workspaces:getVisible', () => workspaceDb.getVisibleWorkspaces());
ipcMain.handle('workspaces:create', (_, workspace) => {
  const workspaceId =
    workspace.id || `workspace_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  workspaceDb.addWorkspace({
    id: workspaceId,
    path: workspace.path,
    name: workspace.name,
    is_temporary: workspace.is_temporary || 0,
    show_in_list: workspace.show_in_list !== undefined ? workspace.show_in_list : 1,
  });
  // Return the created workspace
  return workspaceDb.getWorkspace(workspaceId);
});
ipcMain.handle('workspaces:update', (_, id, workspace) =>
  workspaceDb.updateWorkspace(id, workspace)
);
ipcMain.handle('workspaces:delete', (_, id) => workspaceDb.deleteWorkspace(id));
ipcMain.handle('workspaces:toggleVisibility', (_, id) => workspaceDb.toggleWorkspaceVisibility(id));

// Prompt App Management
ipcMain.handle('promptApps:list', () => promptAppDb.getPromptApps());
ipcMain.handle('promptApps:get', (_, id) => promptAppDb.getPromptApp(id));
ipcMain.handle('promptApps:getEnabled', () => promptAppDb.getEnabledPromptApps());
ipcMain.handle('promptApps:create', (_, app) => {
  const appId = app.id || `promptApp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  promptAppDb.addPromptApp({
    id: appId,
    name: app.name,
    description: app.description || null,
    icon: app.icon || null,
    prompt_template: app.prompt_template,
    placeholders: app.placeholders || '[]',
    model: app.model || null,
    enabled: app.enabled !== undefined ? app.enabled : 1,
    sort_order: app.sort_order || 0,
    tools: app.tools || null,
    reasoning_effort: app.reasoning_effort || null,
    expects_image_result: app.expects_image_result || 0,
    is_incognito: app.is_incognito || 0,
    shortcut: app.shortcut || null,
    window_width: app.window_width || null,
    window_height: app.window_height || null,
    font_size: app.font_size || null,
  });
  // Return the created app
  return promptAppDb.getPromptApp(appId);
});
ipcMain.handle('promptApps:update', (_, id, app) => promptAppDb.updatePromptApp(id, app));
ipcMain.handle('promptApps:delete', (_, id) => promptAppDb.deletePromptApp(id));
ipcMain.handle('promptApps:toggleEnabled', (_, id) => promptAppDb.togglePromptAppEnabled(id));
ipcMain.handle('promptApps:updateSortOrder', (_, id, sortOrder) =>
  promptAppDb.updatePromptAppSortOrder(id, sortOrder)
);

// Tool Model Management
ipcMain.handle('toolModel:get', () => {
  try {
    return getToolModel();
  } catch (error: unknown) {
    console.error('Failed to get tool model:', error);
    return null;
  }
});

ipcMain.handle('tools:list', () => {
  try {
    return defaultToolRegistry.getToolMetadata();
  } catch (error: unknown) {
    console.error('Failed to list tools:', error);
    return [];
  }
});

ipcMain.handle('skills:list', async () => {
  try {
    return await listSkills({ forceRefresh: true });
  } catch (error: unknown) {
    console.error('Failed to list skills:', error);
    return [];
  }
});

ipcMain.handle('skills:roots', () => {
  try {
    return getSkillRootsForUi();
  } catch (error: unknown) {
    console.error('Failed to get skill roots:', error);
    return [];
  }
});

ipcMain.handle('skills:open-root', async (_, source?: string) => {
  try {
    const roots = getSkillRootsForUi();
    const normalizedSource = source === 'codex' ? 'codex' : 'user';
    const target = roots.find(r => r.source === normalizedSource) || roots[0];
    if (!target?.path) {
      return { success: false, error: 'No skills folder configured' };
    }

    await fs.mkdir(target.path, { recursive: true });
    const errorText = await shell.openPath(target.path);
    if (errorText) {
      return { success: false, error: errorText, path: target.path };
    }
    return { success: true, path: target.path };
  } catch (error: unknown) {
    return { success: false, error: getErrorMessage(error) };
  }
});

ipcMain.handle('skills:open-skill', async (_, id: string) => {
  try {
    const folderPath = await getSkillFolderPath(id);
    if (!folderPath) {
      return { success: false, error: 'Skill not found' };
    }
    const errorText = await shell.openPath(folderPath);
    if (errorText) {
      return { success: false, error: errorText, path: folderPath };
    }
    return { success: true, path: folderPath };
  } catch (error: unknown) {
    return { success: false, error: getErrorMessage(error) };
  }
});

ipcMain.handle('skills:read', async (_, id: string, options?: { maxChars?: number }) => {
  try {
    const content = await readSkillContent(id, { maxChars: options?.maxChars });
    if (!content) {
      return { success: false, error: 'Skill not found' };
    }
    return { success: true, ...content };
  } catch (error: unknown) {
    return { success: false, error: getErrorMessage(error) };
  }
});

ipcMain.handle('toolModel:generateTitle', async (_, conversationContent: string) => {
  try {
    return await generateTitleWithAgent(conversationContent);
  } catch (error: unknown) {
    console.error('Failed to generate title with agent:', error);
    return null;
  }
});

// Chat/LLM Integration
import * as llmFactory from './core/provider/llm/factory';
import * as deepseekProvider from './core/provider/llm/deepseek';
import * as openaiProvider from './core/provider/llm/openai';
import * as kimiProvider from './core/provider/llm/kimi';

// Get available models for a provider type
ipcMain.handle('chat:getModels', async (_, providerType: string) => {
  try {
    // 1. Try provider-specific cache if it exists (e.g. for DeepSeek special logic)
    if (providerType === 'deepseek') return await deepseekProvider.getDeepSeekModels();
    if (providerType === 'openai') return await openaiProvider.getOpenAIModels();
    if (providerType === 'kimi') return await kimiProvider.getKimiModels();

    // 2. Fallback to general factory fetch
    return await llmFactory.fetchModelsFromDev(providerType);
  } catch (error: unknown) {
    console.error(`Failed to get models for ${providerType}:`, error);
    return [];
  }
});

// Check if a provider is configured
ipcMain.handle('chat:isProviderConfigured', (_, providerType: string) => {
  try {
    const config = llmFactory.getProviderConfig(providerType);
    return !!config.apiKey;
  } catch {
    return false;
  }
});

ipcMain.handle('chat:stop-stream', event => {
  const streamState = activeStreams.get(event.sender.id);
  if (!streamState) {
    console.log(`[StreamDebug][Main][${event.sender.id}] stop-stream ignored: no active stream`);
    return { success: false, error: 'No active stream' };
  }

  streamState.cancelled = true;
  streamState.stoppedByUser = true;
  streamState.abortController.abort('user-stop-request');
  console.log(`[StreamDebug][Main][${event.sender.id}] stop-stream acknowledged`);
  return { success: true };
});

// Send a chat message (non-streaming)
ipcMain.handle(
  'chat:send',
  async (
    _,
    options: {
      providerType: string;
      model: string;
      messages: ChatTransportMessage[];
      tools?: string[]; // Optional specific tools to enable
      skillIds?: string[]; // Optional skill ids to inject into system prompt
      skillMode?: 'manual' | 'auto';
      threadId?: string;
    }
  ) => {
    try {
      const inputMessages = injectMemoryIntoMessages(
        await toModelInputMessages(options.messages),
        options.threadId
      );

      const skillMode = options.skillMode === 'auto' ? 'auto' : 'manual';
      const normalizedThreadId =
        typeof options.threadId === 'string' ? options.threadId.trim() : '';

      let pinnedSkillIds: string[] = [];
      if (normalizedThreadId) {
        try {
          const thread = chatThreadDb.getChatThread(normalizedThreadId);
          if (thread?.skill_ids) {
            pinnedSkillIds = normalizeSkillIds(JSON.parse(thread.skill_ids));
          }
        } catch (error) {
          console.warn('[Main] Failed to resolve skill_ids from thread:', error);
        }
      }

      let normalizedSkillIds = normalizeSkillIds(options.skillIds);

      if (skillMode === 'manual') {
        // Manual mode: use explicit skills if provided, otherwise fall back to pinned thread skills.
        if (normalizedSkillIds.length === 0 && !Array.isArray(options.skillIds)) {
          normalizedSkillIds = pinnedSkillIds;
        }

        // Persist explicit selection (including empty array to clear pinned skills).
        if (normalizedThreadId && Array.isArray(options.skillIds)) {
          try {
            chatThreadDb.updateChatThread(normalizedThreadId, {
              skill_ids: JSON.stringify(normalizedSkillIds),
            });
          } catch (error) {
            console.warn('[Main] Failed to persist skill_ids for thread:', error);
          }
        }
      } else {
        // Auto mode: pick relevant skills per message using tool model, plus pinned thread skills.
        const availableSkillCatalog = (await listSkills()).map(skill => ({
          id: skill.id,
          name: skill.name,
          description: skill.description,
          source: skill.source,
        }));

        const autoSelectedSkillIds = await selectSkillsWithAgent({
          messages: toLlmChatMessages(inputMessages),
          availableSkills: availableSkillCatalog,
        });

        if (autoSelectedSkillIds.length > 0) {
          console.log('[Main] Auto-selected skills:', autoSelectedSkillIds);
        }

        const union = new Set<string>();
        for (const id of pinnedSkillIds) union.add(id);
        for (const id of autoSelectedSkillIds) union.add(id);
        normalizedSkillIds = Array.from(union);
      }

      const skillsSystemPrompt =
        normalizedSkillIds.length > 0 ? await buildSkillsSystemPrompt(normalizedSkillIds) : '';

      if (options.tools && options.tools.length > 0) {
        // Use Agent if tools are specified
        const agent = new SimpleAgent({
          enabled: true,
          providerType: options.providerType,
          model: options.model,
          systemPrompt:
            [TOOL_AGENT_SYSTEM_PROMPT, skillsSystemPrompt].filter(Boolean).join('\n\n'), // Persona is already integrated in SimpleAgent
          enableTools: true,
          maxIterations: 5,
        });

        // Register selected tools
        for (const toolName of options.tools) {
          const tool = defaultToolRegistry.get(toolName);
          if (tool) agent.registerTool(tool);
        }

        // Separate user prompt from history
        const history = inputMessages.slice(0, -1);
        const lastMessage = inputMessages[inputMessages.length - 1];
        const prompt = getPromptFromMessage(lastMessage);

        if (!prompt.trim()) {
          throw new Error('No user prompt provided for tool-enabled chat');
        }

        agent.setMessages(toAgentMessages(history));
        const result = await agent.generate(prompt);
        return { success: true, text: result.response };
      } else {
        // Fallback to simple LLM call
        const text = await llmFactory.generateChat({
          providerType: options.providerType,
          modelId: options.model,
          messages: toLlmChatMessages(inputMessages),
          extraSystemPrompt: skillsSystemPrompt,
        });
        return { success: true, text };
      }
    } catch (error: unknown) {
      return { success: false, error: getErrorMessage(error) };
    }
  }
);

// Stream a chat response
ipcMain.handle(
  'chat:stream',
  async (
    event,
    options: {
      providerType: string;
      model: string;
      messages: ChatTransportMessage[];
      tools?: string[];
      skillIds?: string[];
      skillMode?: 'manual' | 'auto';
      threadId?: string;
    }
  ) => {
    const webContents = event.sender as ChatWebContents;
    const senderId = webContents.id;
    const streamDebugId = `${senderId}-${Date.now()}`;
    const existingStream = activeStreams.get(senderId);
    if (existingStream) {
      existingStream.cancelled = true;
      existingStream.abortController.abort('superseded-by-new-request');
    }

    const streamState: ActiveStreamState = {
      cancelled: false,
      stoppedByUser: false,
      abortController: new AbortController(),
    };
    const uiChunkEmitter = createUiChunkEmitter(webContents);
    activeStreams.set(senderId, streamState);
    let partialResponse = '';
    let llmChunkCount = 0;
    const streamStartedAt = Date.now();
    console.log(
      `[StreamDebug][Main][${streamDebugId}] start provider=${options.providerType} model=${options.model} messageCount=${options.messages?.length ?? 0} toolCount=${options.tools?.length ?? 0}`
    );

    try {
      const inputMessages = injectMemoryIntoMessages(
        await toModelInputMessages(options.messages),
        options.threadId
      );

      const skillMode = options.skillMode === 'auto' ? 'auto' : 'manual';
      const normalizedThreadId =
        typeof options.threadId === 'string' ? options.threadId.trim() : '';

      let pinnedSkillIds: string[] = [];
      if (normalizedThreadId) {
        try {
          const thread = chatThreadDb.getChatThread(normalizedThreadId);
          if (thread?.skill_ids) {
            pinnedSkillIds = normalizeSkillIds(JSON.parse(thread.skill_ids));
          }
        } catch (error) {
          console.warn('[Main] Failed to resolve skill_ids from thread:', error);
        }
      }

      let normalizedSkillIds = normalizeSkillIds(options.skillIds);

      if (skillMode === 'manual') {
        if (normalizedSkillIds.length === 0 && !Array.isArray(options.skillIds)) {
          normalizedSkillIds = pinnedSkillIds;
        }

        if (normalizedThreadId && Array.isArray(options.skillIds)) {
          try {
            chatThreadDb.updateChatThread(normalizedThreadId, {
              skill_ids: JSON.stringify(normalizedSkillIds),
            });
          } catch (error) {
            console.warn('[Main] Failed to persist skill_ids for thread:', error);
          }
        }
      } else {
        const availableSkillCatalog = (await listSkills()).map(skill => ({
          id: skill.id,
          name: skill.name,
          description: skill.description,
          source: skill.source,
        }));

        const autoSelectedSkillIds = await selectSkillsWithAgent({
          messages: toLlmChatMessages(inputMessages),
          availableSkills: availableSkillCatalog,
        });

        if (autoSelectedSkillIds.length > 0) {
          console.log('[Main] Auto-selected skills:', autoSelectedSkillIds);
        }

        const union = new Set<string>();
        for (const id of pinnedSkillIds) union.add(id);
        for (const id of autoSelectedSkillIds) union.add(id);
        normalizedSkillIds = Array.from(union);
      }

      const skillsSystemPrompt =
        normalizedSkillIds.length > 0 ? await buildSkillsSystemPrompt(normalizedSkillIds) : '';

      const explicitTools = Array.isArray(options.tools)
        ? options.tools.filter(
            (toolName): toolName is string =>
              typeof toolName === 'string' && toolName.trim().length > 0
          )
        : [];

      let resolvedTools = explicitTools;

      if (resolvedTools.length === 0) {
        const availableTools = defaultToolRegistry
          .getToolMetadata()
          .map(t => ({ name: t.name, description: t.description }));
        resolvedTools = await selectToolsWithAgent({
          messages: toLlmChatMessages(inputMessages),
          availableTools,
        });
        if (resolvedTools.length > 0) {
          console.log('[Main] Auto-selected tools:', resolvedTools);
        }
      }

      if (normalizedThreadId) {
        try {
          const thread = chatThreadDb.getChatThread(normalizedThreadId);
          let parsedMetadata: unknown = {};
          try {
            parsedMetadata =
              thread?.metadata && thread.metadata.trim().length > 0
                ? JSON.parse(thread.metadata)
                : {};
          } catch {
            parsedMetadata = {};
          }

          const metadataRecord = isObjectRecord(parsedMetadata) ? parsedMetadata : {};
          const nextLlm = isObjectRecord(metadataRecord.llm) ? metadataRecord.llm : {};

          chatThreadDb.updateChatThread(normalizedThreadId, {
            model: options.model || thread?.model || null,
            tools: resolvedTools.length > 0 ? JSON.stringify(resolvedTools) : null,
            metadata: JSON.stringify({
              ...metadataRecord,
              llm: {
                ...(nextLlm as Record<string, unknown>),
                providerType: options.providerType,
                model: options.model,
                updatedAt: new Date().toISOString(),
              },
            }),
          } as any);
        } catch (error) {
          console.warn('[Main] Failed to persist thread runtime hints:', error);
        }
      }

      if (resolvedTools.length > 0) {
        const agent = new SimpleAgent({
          enabled: true,
          providerType: options.providerType,
          model: options.model,
          systemPrompt: [TOOL_AGENT_SYSTEM_PROMPT, skillsSystemPrompt].filter(Boolean).join('\n\n'),
          enableTools: true,
          maxIterations: 5,
        });

        console.log(
          '[Main] Streaming chat with tools:',
          resolvedTools,
          explicitTools.length > 0 ? '(manual)' : '(auto)'
        );

        for (const toolName of resolvedTools) {
          const tool = defaultToolRegistry.get(toolName);
          console.log(`[Main] Registering tool: ${toolName}`, tool ? 'found' : 'not found');
          if (tool) {
            agent.registerTool(tool);
          } else {
            console.warn(`[Main] Tool ${toolName} not found in registry`);
          }
        }

        console.log('[Main] Registered tools count:', agent.getTools().length);

        if (!inputMessages || inputMessages.length === 0) {
          throw new Error('No messages provided for streaming');
        }

        const history = inputMessages.slice(0, -1);
        const lastMessage = inputMessages[inputMessages.length - 1];
        const prompt = getPromptFromMessage(lastMessage);

        if (!prompt.trim()) {
          throw new Error('No user prompt provided for tool-enabled stream');
        }

        agent.setMessages(toAgentMessages(history));
        const streamResult = await streamAgentResponse(
          agent,
          webContents,
          prompt,
          undefined,
          () => streamState.cancelled,
          streamDebugId,
          eventPart => {
            if (
              eventPart.type === 'tool-approval-request' &&
              typeof eventPart.approvalId === 'string' &&
              eventPart.approvalId.length > 0
            ) {
              ensurePendingApprovalSession(eventPart.approvalId, { agent, webContents });
            }
            uiChunkEmitter.emitToolEvent(eventPart);
          },
          streamState.abortController.signal,
          uiChunkEmitter
        );
        console.log(
          `[StreamDebug][Main][${streamDebugId}] complete mode=agent stopped=${streamState.stoppedByUser} awaitingApproval=${streamResult.awaitingApproval ?? false} durationMs=${Date.now() - streamStartedAt}`
        );
        return {
          success: true,
          awaitingApproval: streamResult.awaitingApproval,
          stopped: streamState.stoppedByUser,
        };
      } else {
        const result = await llmFactory.streamChat(
          {
            providerType: options.providerType,
            modelId: options.model,
            messages: toLlmChatMessages(inputMessages),
            extraSystemPrompt: skillsSystemPrompt,
          },
          chunk => {
            if (streamState.cancelled) return;
            partialResponse += chunk;
            llmChunkCount += 1;
            if (shouldLogChunk(llmChunkCount)) {
              console.log(
                `[StreamDebug][Main][${streamDebugId}] chunk#${llmChunkCount} len=${chunk.length} totalChars=${partialResponse.length}`
              );
            }
            uiChunkEmitter.emitTextDelta(chunk);
          },
          () => streamState.cancelled,
          streamState.abortController.signal
        );
        const finalText = streamState.cancelled ? partialResponse : result;
        console.log(
          `[StreamDebug][Main][${streamDebugId}] complete mode=llm stopped=${streamState.stoppedByUser} chunkCount=${llmChunkCount} partialLen=${partialResponse.length} finalLen=${(finalText || '').length} durationMs=${Date.now() - streamStartedAt}`
        );
        if (streamState.cancelled) {
          uiChunkEmitter.abort();
        } else {
          uiChunkEmitter.finish();
        }
        return { success: true, stopped: streamState.stoppedByUser };
      }
    } catch (error: unknown) {
      if (streamState.cancelled) {
        console.log(
          `[StreamDebug][Main][${streamDebugId}] cancelled-in-catch chunkCount=${llmChunkCount} partialLen=${partialResponse.length} durationMs=${Date.now() - streamStartedAt}`
        );
        uiChunkEmitter.abort();
        return { success: true, stopped: streamState.stoppedByUser };
      }
      const message = getErrorMessage(error);
      console.error(
        `[StreamDebug][Main][${streamDebugId}] error=${message} durationMs=${Date.now() - streamStartedAt}`
      );
      uiChunkEmitter.error(message);
      return { success: false, error: message };
    } finally {
      if (activeStreams.get(senderId) === streamState) {
        activeStreams.delete(senderId);
      }
    }
  }
);

// Handle tool approval
ipcMain.handle('chat:approve-tool', async (event, approvalId: string, approved: boolean) => {
  console.log(`[Main] Tool approval: ${approvalId}, approved: ${approved}`);
  const webContents = event.sender as ChatWebContents;

  let session = pendingApprovalSessions.get(approvalId);
  if (!session) {
    session = await tryRecoverApprovalSession(approvalId, webContents);
  }
  if (!session) {
    return {
      success: false,
      error: 'Approval request not found or already processed.',
    };
  }

  // Ensure the resumed stream emits UI chunks to the window that initiated the approval.
  session.webContents = webContents;

  const approvalResponse: ToolApprovalResponse = {
    type: 'tool-approval-response',
    approvalId,
    approved,
    reason: approved ? 'User approved tool execution.' : 'User rejected tool execution.',
  };

  if (session.collectedApprovalResponses.has(approvalId)) {
    return {
      success: false,
      error: 'Approval request already processed.',
    };
  }

  session.collectedApprovalResponses.set(approvalId, approvalResponse);

  const waitingForApprovals = Array.from(session.pendingApprovalIds).filter(
    id => !session.collectedApprovalResponses.has(id)
  );

  if (waitingForApprovals.length > 0) {
    console.log(
      `[Main] Tool approval pending batch completion: resolved=${session.collectedApprovalResponses.size} total=${session.pendingApprovalIds.size} waiting=${waitingForApprovals.join(',')}`
    );
    return {
      success: true,
      awaitingApproval: true,
      waitingForApprovals,
    };
  }

  for (const pendingId of session.pendingApprovalIds) {
    pendingApprovalSessions.delete(pendingId);
  }

  const senderId = session.webContents.id;
  const existingStream = activeStreams.get(senderId);
  if (existingStream) {
    existingStream.cancelled = true;
    existingStream.abortController.abort('resume-after-tool-approval');
  }

  const streamState: ActiveStreamState = {
    cancelled: false,
    stoppedByUser: false,
    abortController: new AbortController(),
  };
  const uiChunkEmitter = createUiChunkEmitter(session.webContents);
  activeStreams.set(senderId, streamState);

  try {
    const streamResult = await streamAgentResponse(
      session.agent,
      session.webContents,
      '',
      Array.from(session.collectedApprovalResponses.values()),
      () => streamState.cancelled,
      undefined,
      eventPart => {
        if (
          eventPart.type === 'tool-approval-request' &&
          typeof eventPart.approvalId === 'string' &&
          eventPart.approvalId.length > 0
        ) {
          ensurePendingApprovalSession(eventPart.approvalId, {
            agent: session.agent,
            webContents: session.webContents,
          });
        }
        uiChunkEmitter.emitToolEvent(eventPart);
      },
      streamState.abortController.signal,
      uiChunkEmitter
    );
    return {
      success: true,
      awaitingApproval: streamResult.awaitingApproval,
      stopped: streamState.stoppedByUser,
    };
  } catch (error: unknown) {
    const message = getErrorMessage(error);
    if (streamState.cancelled) {
      uiChunkEmitter.abort();
      return { success: true, stopped: streamState.stoppedByUser };
    }
    uiChunkEmitter.error(message);
    return { success: false, error: message };
  } finally {
    if (activeStreams.get(senderId) === streamState) {
      activeStreams.delete(senderId);
    }
  }
});

ipcMain.on('open-settings', () => {
  const settingsWindow = new BrowserWindow({
    width: 1000,
    height: 750,
    minWidth: 800,
    minHeight: 600,
    title: 'Settings',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 20, y: 20 },
    vibrancy: 'sidebar',
    webPreferences: {
      preload: path.join(__dirname, './index.js'),
      nodeIntegration: false,
      devTools: !app.isPackaged,
    },
  });

  if (!app.isPackaged) {
    const devUrl = getRendererDevServerUrl();
    const url = devUrl.endsWith('/') ? devUrl : `${devUrl}/`;
    settingsWindow.loadURL(`${url}#settings`);
  } else {
    settingsWindow.loadFile(getRendererProdHtmlPath(), {
      hash: 'settings',
    });
  }

  settingsWindow.webContents.openDevTools({ mode: 'detach' });
});

ipcMain.on('close-window', event => {
  const win = BrowserWindow.fromWebContents(event.sender);
  win?.close();
});

const createWindow = () => {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    frame: false,
    // macOS
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 20, y: 20 },
    vibrancy: 'sidebar',

    webPreferences: {
      preload: path.join(__dirname, './index.js'),
      nodeIntegration: false,
    },
    // ...(process.platform !== 'darwin' ? { titleBarOverlay: true } : {}),
  });

  // and load the index.html of the app.
  if (!app.isPackaged) {
    mainWindow.loadURL(getRendererDevServerUrl());
  } else {
    const indexPath = getRendererProdHtmlPath();
    mainWindow.loadFile(indexPath);
    console.log('Loaded index.html from file', indexPath);
  }

  if (!app.isPackaged) {
    mainWindow.webContents.openDevTools();
  }
};

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on('ready', createWindow);

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.
