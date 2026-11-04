import type { ChatThread } from '@iki/backend/types/chat';
import { parseJsonRecord } from '@iki/backend/message/thread_runtime_hints';
import { normalizeWhitespace } from '@iki/backend/utils/text';

type ThreadOriginInfo = {
  isExternal: boolean;
  source: string | null;
  sourceLabel: string | null;
  channelLabel: string | null;
};

const formatSourceLabel = (value: string): string =>
  value
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map(segment => segment[0].toUpperCase() + segment.slice(1))
    .join(' ');

export const getThreadOriginInfo = (
  thread: Pick<ChatThread, 'id' | 'client_id' | 'metadata'>
): ThreadOriginInfo => {
  const clientId = normalizeWhitespace(thread.client_id);
  const metadata = parseJsonRecord(thread.metadata);
  const source = normalizeWhitespace(metadata.source).toLowerCase();

  if (clientId) {
    const externalSource = source || clientId.replace(/^client_/, '');
    return {
      isExternal: true,
      source: externalSource || null,
      sourceLabel: externalSource ? formatSourceLabel(externalSource) : 'External Client',
      channelLabel: 'External client',
    };
  }

  return {
    isExternal: false,
    source: source || null,
    sourceLabel: null,
    channelLabel: null,
  };
};

export const isExternalThread = (
  thread: Pick<ChatThread, 'id' | 'client_id' | 'metadata'>
): boolean => getThreadOriginInfo(thread).isExternal;
