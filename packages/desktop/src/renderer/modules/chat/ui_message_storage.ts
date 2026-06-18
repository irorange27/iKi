import type { ChatUiMessage } from '@iki/backend/chat/message_parts';
import { parseStoredUiMessageRow } from '@iki/backend/chat/ui_message_codec';

export const parseStoredUiMessage = (row: { id: string; message: string }): ChatUiMessage =>
  parseStoredUiMessageRow(row);
