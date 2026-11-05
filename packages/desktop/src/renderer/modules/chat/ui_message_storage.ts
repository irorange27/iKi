import type { ChatUiMessage } from '@iki/ai/message/message_parts';
import { normalizeUiMessage } from '@iki/ai/message/ui_message_codec';

/**
 * The IPC now carries the structured message exactly as the session log stores
 * it — normalize defensively at the boundary (an old writer's unknown part type
 * must not reach the store); there is no JSON-string row to parse any more.
 */
export const parseStoredUiMessage = (value: unknown): ChatUiMessage | null =>
  normalizeUiMessage(value, { fallbackId: '' });
