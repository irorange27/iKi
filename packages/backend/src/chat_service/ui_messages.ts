import { convertToModelMessages, validateUIMessages } from 'ai';
import type { FileUIPart } from 'ai';

import { extractTextFromModelMessageContent } from '@iki/core/agent/model_messages';
import type {
  ChatUiMessage,
  DynamicToolPart,
  TextPart,
  UiMessagePart,
} from '@iki/backend/chat/message_parts';
import { isChatUiMetadataPart } from '@iki/backend/chat/message_parts';
import { getErrorMessage } from '@iki/core/utils/errors';
import type { ChatInputMessage, ChatTransportMessage, LlmChatMessage } from './types';
import { createPrefixedId } from '@iki/core/utils/id';
import { normalizeToolPartForValidation } from '@iki/backend/chat/tool_parts';
import { isObjectRecord } from '@iki/backend/chat/tool_parts';

const normalizeUiMessagesForValidation = (messages: ChatUiMessage[]): ChatUiMessage[] =>
  messages.flatMap((message, messageIndex) => {
    const messageId =
      typeof message.id === 'string' && message.id.length > 0
        ? message.id
        : createPrefixedId(`ui_msg_${messageIndex}`);

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
            if (isChatUiMetadataPart(partRecord)) {
              return null;
            }
            if (
              partType === 'file' &&
              typeof partRecord.url === 'string' &&
              typeof partRecord.mediaType === 'string'
            ) {
              const filePart: FileUIPart = {
                type: 'file',
                url: partRecord.url,
                mediaType: partRecord.mediaType,
                ...(typeof partRecord.filename === 'string' && partRecord.filename.length > 0
                  ? { filename: partRecord.filename }
                  : {}),
              };
              return filePart;
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
          .filter((part): part is TextPart | DynamicToolPart | FileUIPart => part !== null)
      : [];

    if (parts.length === 0) {
      return [];
    }

    return [
      {
        id: messageId,
        role,
        ...(message.metadata !== undefined ? { metadata: message.metadata } : {}),
        parts,
      },
    ];
  });

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
