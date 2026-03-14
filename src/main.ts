import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
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
import { registerStandardTools, defaultToolRegistry } from './core/tools';
import { SimpleAgent } from './core/agent';
import type { AgentMessage, AgentResult } from './core/agent';

const getRendererDevServerUrl = () => process.env.MAIN_WINDOW_VITE_DEV_SERVER_URL || 'http://localhost:5173';

const getRendererProdHtmlPath = () => path.join(__dirname, '../renderer/main_window/index.html');

const getErrorMessage = (error: unknown) => {
  if (error instanceof Error) return error.message;
  return String(error);
};

const shouldLogChunk = (count: number) => count <= 3 || count % 20 === 0;

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
      message: message.message,
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
    if (typeof message.message === 'string') {
      memoryDb.addShortMemoryFromChatMessage({
        thread_id: message.thread_id,
        message_id: messageId,
        message_json: message.message,
      });
      memoryDb.pruneShortMemory(message.thread_id);
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
  const result = chatMessageDb.updateChatMessage(id, message);
  try {
    const existing = chatMessageDb.getChatMessage(id);
    const threadId = message.thread_id || existing?.thread_id;
    const messageJson = typeof message.message === 'string' ? message.message : existing?.message;
    if (threadId && messageJson) {
      memoryDb.addShortMemoryFromChatMessage({
        thread_id: threadId,
        message_id: id,
        message_json: messageJson,
      });
      memoryDb.pruneShortMemory(threadId);
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
    }
  ) => {
    try {
      const inputMessages = await toModelInputMessages(options.messages);

      if (options.tools && options.tools.length > 0) {
        // Use Agent if tools are specified
        const agent = new SimpleAgent({
          enabled: true,
          providerType: options.providerType,
          model: options.model,
          systemPrompt: '', // Persona is already integrated in SimpleAgent
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
      const inputMessages = await toModelInputMessages(options.messages);

      if (options.tools && options.tools.length > 0) {
        const agent = new SimpleAgent({
          enabled: true,
          providerType: options.providerType,
          model: options.model,
          systemPrompt: '',
          enableTools: true,
          maxIterations: 5,
        });

        console.log('[Main] Streaming chat with tools:', options.tools);

        for (const toolName of options.tools) {
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
ipcMain.handle('chat:approve-tool', async (_, approvalId: string, approved: boolean) => {
  console.log(`[Main] Tool approval: ${approvalId}, approved: ${approved}`);
  const session = pendingApprovalSessions.get(approvalId);
  if (!session) {
    return {
      success: false,
      error: 'Approval request not found or already processed.',
    };
  }

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
