import type { ChatThread } from '@iki/core/types/chat';
import { normalizeWhitespace } from '@iki/core/utils/text';

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

/**
 * A thread is "external" when a client registered it via `client_id`; the
 * label is derived from the id itself. The old second source — a `source`
 * key inside the stringified metadata blob — was never written by any code
 * path and is gone.
 */
export const getThreadOriginInfo = (
  thread: Pick<ChatThread, 'id' | 'client_id'>
): ThreadOriginInfo => {
  const clientId = normalizeWhitespace(thread.client_id);
  if (!clientId) {
    return { isExternal: false, source: null, sourceLabel: null, channelLabel: null };
  }

  const externalSource = clientId.replace(/^client_/, '');
  return {
    isExternal: true,
    source: externalSource || null,
    sourceLabel: externalSource ? formatSourceLabel(externalSource) : 'External Client',
    channelLabel: 'External client',
  };
};

export const isExternalThread = (
  thread: Pick<ChatThread, 'id' | 'client_id'>
): boolean => getThreadOriginInfo(thread).isExternal;
