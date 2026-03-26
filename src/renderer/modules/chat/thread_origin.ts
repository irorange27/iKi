import type { ChatThread } from '../../../shared/types/chat';
import { isObjectRecord } from '../../../shared/utils/guards';

export type ThreadOriginInfo = {
  isExternal: boolean;
  source: string | null;
  sourceLabel: string | null;
  channelLabel: string | null;
};

const normalizeText = (value: unknown): string =>
  typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';

export const parseThreadMetadata = (
  metadataRaw: string | null | undefined
): Record<string, unknown> => {
  const metadata = normalizeText(metadataRaw);
  if (!metadata) return {};

  try {
    const parsed = JSON.parse(metadata);
    return isObjectRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

const formatSourceLabel = (value: string): string =>
  value
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map(segment => segment[0].toUpperCase() + segment.slice(1))
    .join(' ');

const inferNapCatMessageType = (
  threadId: string,
  messageType: string
): 'private' | 'group' | null => {
  if (messageType === 'private' || messageType === 'group') return messageType;
  if (threadId.includes('_private_')) return 'private';
  if (threadId.includes('_group_')) return 'group';
  return null;
};

export const getThreadOriginInfo = (
  thread: Pick<ChatThread, 'id' | 'client_id' | 'metadata'>
): ThreadOriginInfo => {
  const threadId = normalizeText(thread.id);
  const clientId = normalizeText(thread.client_id);
  const metadata = parseThreadMetadata(thread.metadata);
  const source = normalizeText(metadata.source).toLowerCase();
  const messageType = normalizeText(metadata.message_type).toLowerCase();

  const isNapCatThread =
    source === 'napcat' || clientId === 'client_napcat' || threadId.startsWith('napcat_');

  if (isNapCatThread) {
    const inferredType = inferNapCatMessageType(threadId, messageType);
    return {
      isExternal: true,
      source: 'napcat',
      sourceLabel: 'NapCat',
      channelLabel:
        inferredType === 'private' ? 'QQ private' : inferredType === 'group' ? 'QQ group' : 'QQ',
    };
  }

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
