import type { ChatUiMessage } from '@iki/backend/message/message_parts';
import { parseStoredUiMessageRow } from '@iki/backend/message/ui_message_codec';

export const parseStoredUiMessage = (row: { id: string; message: string }): ChatUiMessage =>
  parseStoredUiMessageRow(row);
