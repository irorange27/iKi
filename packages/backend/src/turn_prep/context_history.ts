import { sanitizeModelConversationMessages } from '@iki/ai/message/model_messages';
import type { ChatInputMessage } from '@iki/ai/message/chat_message_types';
import { estimateMessageTokens } from '@iki/backend/agent/context_budget';
import { buildMessagePreview } from './context_helpers';
import type { RecentHistoryContext } from './context_types';

export const selectRecentHistory = (messages: ChatInputMessage[]): RecentHistoryContext => {
  const systemMessages = messages.filter(message => message.role === 'system');
  const sanitized = sanitizeModelConversationMessages(messages.filter(message => message.role !== 'system'));
  return {
    systemMessages,
    recentMessages: sanitized.messages,
    compactedMessages: 0,
    block: {
      kind: 'recent-history',
      status: sanitized.droppedMessages ? 'truncated' : 'included',
      estimatedTokens: sanitized.messages.reduce((sum, message) => sum + estimateMessageTokens(message), 0),
      charCount: sanitized.messages.reduce((sum, message) => sum + buildMessagePreview(message).length, 0),
      sourceCount: sanitized.messages.length,
      ...(sanitized.droppedMessages ? { reason: 'removed orphaned tool messages' } : {}),
    },
  };
};
