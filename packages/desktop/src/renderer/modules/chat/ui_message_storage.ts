import type { ChatUiMessage } from '@iki/core/chat/message_parts';
import { parseStoredUiMessageRow } from '@iki/core/chat/ui_message_codec';

export const parseStoredUiMessage = (row: { id: string; message: string }): ChatUiMessage =>
  parseStoredUiMessageRow(row);
