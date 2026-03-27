import type { ChatUiMessage } from '../../../shared/chat/message_parts';
import { parseStoredUiMessageRow } from '../../../shared/chat/ui_message_codec';

export const parseStoredUiMessage = (row: { id: string; message: string }): ChatUiMessage =>
  parseStoredUiMessageRow(row);
