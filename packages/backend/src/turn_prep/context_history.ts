import { sanitizeModelConversationMessages } from '@iki/backend/agent/model_messages';
import type { ModelCapability } from '@iki/backend/utils/provider_models';
import type { ChatInputMessage } from '../thread_session/types';
import { buildMessagePreview, countMessageTokens } from './context_helpers';
import type { ContextConfig, RecentHistoryContext } from './context_types';

export const selectRecentHistory = (
  messages: ChatInputMessage[],
  _contextConfig: ContextConfig,
  modelCapability?: ModelCapability | null
): RecentHistoryContext => {
  const systemMessages = messages.filter(message => message.role === 'system');
  const sanitized = sanitizeModelConversationMessages(messages.filter(message => message.role !== 'system'));
  return {
    systemMessages,
    recentMessages: sanitized.messages,
    compactedMessages: 0,
    block: {
      kind: 'recent-history',
      status: sanitized.droppedMessages ? 'truncated' : 'included',
      estimatedTokens: sanitized.messages.reduce((sum, message) => sum + countMessageTokens(message, modelCapability), 0),
      charCount: sanitized.messages.reduce((sum, message) => sum + buildMessagePreview(message).length, 0),
      sourceCount: sanitized.messages.length,
      ...(sanitized.droppedMessages ? { reason: 'removed orphaned tool messages' } : {}),
    },
  };
};
