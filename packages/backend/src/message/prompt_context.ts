
import type { ModelMessage } from './model_history';

import {
  extractTextFromModelMessageContent,
  sanitizeModelConversationMessages,
} from '@iki/backend/agent/model_messages';
import type { AgentConfig } from '@iki/backend/agent/types';
import { createLogger } from '@iki/backend/logger';
import {
  assembleRequestSystemPrompt,
  type RequestSystemPromptPart,
} from '@iki/backend/message/system_prompt';
import { resolvePersonaPrompt } from '@iki/backend/provider/llm/factory';

const logger = createLogger({ module: 'prompt_context' });

export const buildPromptContext = (
  config: Pick<AgentConfig, 'providerType' | 'providerId' | 'systemPrompt'>,
  history: ModelMessage[]
): { systemPrompt: string; messages: ModelMessage[] } => {
  const conversationMessages = history.filter(message => message.role !== 'system');
  const sanitizedConversation = sanitizeModelConversationMessages(conversationMessages);
  const sanitized = sanitizedConversation.messages;

  const systemParts: RequestSystemPromptPart[] = [
    { slot: 'persona', text: resolvePersonaPrompt(config.providerType, config.providerId) },
  ];

  if (config.systemPrompt.trim()) {
    systemParts.push({ slot: 'planPrompt', text: config.systemPrompt.trim() });
  }

  for (const message of history) {
    if (message.role !== 'system') continue;
    const content = extractTextFromModelMessageContent(message.content).trim();
    if (content) {
      systemParts.push({ slot: 'transcriptSystem', text: content });
    }
  }

  if (sanitizedConversation.droppedMessages > 0) {
    logger.event({
      level: 'warn',
      event: 'agent.history.tool_messages_sanitized',
      outcome: 'degraded',
      data: {
        dropped_message_count: sanitizedConversation.droppedMessages,
        message_count_before: conversationMessages.length,
        message_count_after: sanitized.length,
      },
    });
  }

  return {
    systemPrompt: assembleRequestSystemPrompt(systemParts).prompt,
    messages: sanitized,
  };
};
