import type { UIMessage } from 'ai';

import { parseStoredUiMessageRow } from '../../../shared/chat/ui_message_codec';

export const parseStoredUiMessage = (row: { id: string; message: string }): UIMessage =>
  parseStoredUiMessageRow(row) as UIMessage;
