import { type Ref } from 'vue';

import type { ChatUiMessage } from '@iki/ai/message/message_parts';
import type { ChatThread } from '@iki/core/types/chat';

import { createLogger } from '../../logger';
import { getCurrentLocale, translateWithLocale } from '../../i18n';
import { extractTextFromMessage } from '../../modules/chat/ui_message_text';
import { normalizeWorkspaceId } from './normalize';

const threadTitleLogger = createLogger({ module: 'thread_session_store' });

const TITLE_REGEN_INTERVAL = 2;
const TITLE_FORCE_REGEN_LIMIT = 5;
const DEFAULT_THREAD_TITLES = new Set([
  translateWithLocale('en', 'chat.thread.newTitle'),
  translateWithLocale('zh-CN', 'chat.thread.newTitle'),
]);

type ThreadTitleContext = {
  requireRuntime: () => { electronAPI: { chat: { threads: { update: (id: string, patch: unknown) => Promise<unknown> } }; toolModel: { generateTitle: (content: string) => Promise<string | null> } } };
  currentThread: Ref<ChatThread | null>;
  refreshThreads: () => Promise<void>;
};

/**
 * Title lifecycle for the thread session store: clearing inputs, manual title
 * updates and model-generated regeneration. Receives the store's state refs by
 * reference so the setup store keeps a single source of truth.
 */
export const createThreadTitleActions = (ctx: ThreadTitleContext) => {
  const { requireRuntime, currentThread, refreshThreads } = ctx;

  const buildClearedThreadInput = (thread: ChatThread): Partial<ChatThread> => ({
    id: thread.id,
    title: translateWithLocale(getCurrentLocale(), 'chat.thread.newTitle'),
    model: typeof thread.model === 'string' && thread.model.trim() ? thread.model : undefined,
    reasoning_effort:
      typeof thread.reasoning_effort === 'string' && thread.reasoning_effort.trim()
        ? thread.reasoning_effort
        : undefined,
    metadata:
      typeof thread.metadata === 'string' && thread.metadata.trim() ? thread.metadata : '{}',
    client_id:
      typeof thread.client_id === 'string' && thread.client_id.trim()
        ? thread.client_id
        : undefined,
    is_favorited: thread.is_favorited ? 1 : 0,
    is_incognito: thread.is_incognito ? 1 : 0,
    workspace_id: normalizeWorkspaceId(thread.workspace_id) ?? undefined,
    enable_artifacts: thread.enable_artifacts ? 1 : 0,
    artifact_workspace_id:
      typeof thread.artifact_workspace_id === 'string' && thread.artifact_workspace_id.trim()
        ? thread.artifact_workspace_id
        : undefined,
  });

  const updateThreadTitle = async (title: string) => {
    const { electronAPI } = requireRuntime();
    if (!currentThread.value) return;
    if (currentThread.value.title === title) return;

    try {
      await electronAPI.chat.threads.update(currentThread.value.id, { title });
      if (currentThread.value) {
        currentThread.value.title = title;
      }
      await refreshThreads();
    } catch (error) {
      threadTitleLogger.event({
        level: 'error',
        event: 'chat.thread.title_update',
        outcome: 'failed',
        error,
        entity: {
          thread_id: currentThread.value.id,
        },
      });
    }
  };

  const updateThreadTitleById = async (threadId: string, title: string) => {
    const { electronAPI } = requireRuntime();
    if (!threadId || !title.trim()) return;

    if (currentThread.value?.id === threadId) {
      await updateThreadTitle(title);
      return;
    }

    try {
      await electronAPI.chat.threads.update(threadId, { title });
      await refreshThreads();
    } catch (error) {
      threadTitleLogger.event({
        level: 'error',
        event: 'chat.thread.title_update',
        outcome: 'failed',
        error,
        entity: {
          thread_id: threadId,
        },
      });
    }
  };

  const getConversationContentForTitle = (messages: ChatUiMessage[]): string => {
    const lines: string[] = [];

    for (const message of messages) {
      const text = extractTextFromMessage(message).trim();
      if (!text) continue;

      if (message.role === 'user') {
        lines.push(`User: ${text}`);
      } else if (message.role === 'assistant') {
        const truncated = text.length > 300 ? text.slice(0, 297) + '...' : text;
        lines.push(`Assistant: ${truncated}`);
      }
    }

    return lines.join('\n');
  };

  const getFallbackThreadTitle = (messages: ChatUiMessage[]): string | null => {
    const userTexts = [...messages]
      .reverse()
      .filter(message => message.role === 'user')
      .map(message => extractTextFromMessage(message).trim())
      .filter(text => text.length > 0);
    const bestText = userTexts.find(text => text.length > 10) ?? userTexts[0];
    if (!bestText) return null;
    return bestText.slice(0, 50) + (bestText.length > 50 ? '...' : '');
  };

  const shouldRegenerateThreadTitle = (
    messages: ChatUiMessage[],
    currentTitle: string
  ): boolean => {
    const assistantMessageCount = messages.filter(message => message.role === 'assistant').length;
    if (assistantMessageCount === 0) return false;
    if (DEFAULT_THREAD_TITLES.has(currentTitle)) return true;
    if (assistantMessageCount <= TITLE_FORCE_REGEN_LIMIT) return true;
    return assistantMessageCount % Math.max(TITLE_REGEN_INTERVAL, 2) === 0;
  };

  const generateThreadTitle = async (messages: ChatUiMessage[]): Promise<string | null> => {
    const { electronAPI } = requireRuntime();
    try {
      const conversationContent = getConversationContentForTitle(messages);
      if (!conversationContent.trim()) {
        return getFallbackThreadTitle(messages);
      }

      const title = await electronAPI.toolModel.generateTitle(conversationContent);
      return title || getFallbackThreadTitle(messages);
    } catch (error) {
      threadTitleLogger.event({
        level: 'error',
        event: 'chat.thread.title_generate',
        outcome: 'failed',
        error,
      });
      return getFallbackThreadTitle(messages);
    }
  };

  const handleAssistantMessagePersisted = async (params: {
    threadId: string;
    messagesSnapshot: ChatUiMessage[];
  }) => {
    if (!currentThread.value || currentThread.value.id !== params.threadId) return;

    if (
      params.messagesSnapshot.length > 0 &&
      shouldRegenerateThreadTitle(params.messagesSnapshot, currentThread.value.title)
    ) {
      const generatedTitle = await generateThreadTitle(params.messagesSnapshot);
      if (generatedTitle) {
        await updateThreadTitleById(params.threadId, generatedTitle);
      }
    }
  };

  return {
    buildClearedThreadInput,
    updateThreadTitle,
    updateThreadTitleById,
    handleAssistantMessagePersisted,
  };
};
