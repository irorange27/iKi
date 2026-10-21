import { sanitizeModelConversationMessages } from '@iki/backend/agent/model_messages';
import type { ModelCapability } from '@iki/backend/utils/provider_models';
import type { ChatInputMessage } from '@iki/backend/message/chat_message_types';
import { buildMessagePreview, countMessageTokens } from './context_helpers';
import type { RecentHistoryContext } from './context_types';

/**
 * History passes through unchanged (sanitized, not clipped).
 *
 * There is no token/count budget parameter because assembly time is not where
 * history is sized: the model-step budget (`agent/runners/pi_turn_budget.ts`
 * over the pure planner `agent/context_budget.ts`) is the single owner of that
 * decision and runs at the wire boundary where the real cost is known.
 * Slicing history here too would make two authorities over one state.
 */
export const selectRecentHistory = (
  messages: ChatInputMessage[],
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
