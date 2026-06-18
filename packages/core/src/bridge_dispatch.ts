import * as chatThreadDb from './db/chat_thread';
import { createDaemonLogger } from './daemon_logs';
import type { ChatThread } from './types/chat';
import { isObjectRecord } from './utils/guards';
import { getErrorMessage } from './utils/errors';

export type BridgeThreadMessageSender = (params: {
  thread: ChatThread;
  text: string;
}) => Promise<void>;

export type BridgeThreadDeliveryResult = {
  handled: boolean;
  delivered: boolean;
  source?: string;
  error?: string;
};

const bridgeThreadSenders = new Map<string, BridgeThreadMessageSender>();
const bridgeDispatchLogger = createDaemonLogger({
  module: 'bridge_dispatch',
  source: 'bridge-dispatch',
});

const parseThreadMetadata = (thread: Pick<ChatThread, 'id' | 'metadata'>): Record<string, unknown> => {
  if (typeof thread.metadata !== 'string' || !thread.metadata.trim()) return {};

  try {
    const parsed = JSON.parse(thread.metadata);
    return isObjectRecord(parsed) ? parsed : {};
  } catch (error) {
    bridgeDispatchLogger.event({
      level: 'warn',
      event: 'bridge.dispatch.metadata',
      outcome: 'degraded',
      error,
      message: 'Failed to parse bridge thread metadata; falling back to thread heuristics.',
      data: {
        thread_id: thread.id,
      },
    });
    return {};
  }
};

export const getBridgeThreadSource = (
  thread: Pick<ChatThread, 'id' | 'client_id' | 'metadata'>
): string | null => {
  const metadata = parseThreadMetadata(thread);
  const metadataSource = typeof metadata.source === 'string' ? metadata.source.trim() : '';
  if (metadataSource) return metadataSource;

  if (thread.client_id === 'client_napcat' || thread.id.startsWith('napcat_')) {
    return 'napcat';
  }

  return null;
};

export const registerBridgeThreadSender = (
  source: string,
  sender: BridgeThreadMessageSender
): (() => void) => {
  const normalizedSource = source.trim();
  bridgeThreadSenders.set(normalizedSource, sender);

  return () => {
    if (bridgeThreadSenders.get(normalizedSource) === sender) {
      bridgeThreadSenders.delete(normalizedSource);
    }
  };
};

export const deliverBridgeThreadMessage = async (params: {
  threadId: string;
  text: string;
}): Promise<BridgeThreadDeliveryResult> => {
  const thread = chatThreadDb.getChatThread(params.threadId);
  if (!thread) {
    return {
      handled: false,
      delivered: false,
      error: 'Thread not found',
    };
  }

  const source = getBridgeThreadSource(thread);
  if (!source) {
    return {
      handled: false,
      delivered: false,
    };
  }

  const sender = bridgeThreadSenders.get(source);
  if (!sender) {
    return {
      handled: true,
      delivered: false,
      source,
      error: `${source} bridge is not connected`,
    };
  }

  try {
    await sender({
      thread,
      text: params.text,
    });
    return {
      handled: true,
      delivered: true,
      source,
    };
  } catch (error) {
    return {
      handled: true,
      delivered: false,
      source,
      error: getErrorMessage(error),
    };
  }
};
