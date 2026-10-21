import type { UiChatTransport } from '@iki/backend/message/ui_protocol';

import type { ChatInvocationOptions, ElectronApi } from '@iki/backend/types/electron_api';
import { clonePlainData } from '@iki/backend/utils/clone';
import { isObjectRecord } from '@iki/backend/utils/guards';
import { createLogger } from '../../logger';
import type { ChatUiMessageChunk } from '@iki/backend/message/message_parts';

const transportLogger = createLogger({ module: 'ipc_chat_transport' });

type ChunkTap = (chunk: ChatUiMessageChunk) => void;

type InboundSlot = {
  stream: ReadableStream<ChatUiMessageChunk>;
  enqueue: (chunk: ChatUiMessageChunk) => void;
  close: () => void;
  fail: (error: Error) => void;
  bound: boolean;
  closed: boolean;
  
  trace: string[];
};

const describeChunk = (chunk: ChatUiMessageChunk): string => {
  const toolCallId = (chunk as { toolCallId?: unknown }).toolCallId;
  const messageId = (chunk as { messageId?: unknown }).messageId;
  return [
    chunk.type,
    typeof toolCallId === 'string' ? toolCallId : '',
    typeof messageId === 'string' ? messageId : '',
  ]
    .filter(Boolean)
    .join(':');
};

const createInboundSlot = (): InboundSlot => {
  const slot: InboundSlot = {
    bound: false,
    closed: false,
    trace: [],
    stream: null as unknown as ReadableStream<ChatUiMessageChunk>,
    enqueue: () => undefined,
    close: () => undefined,
    fail: () => undefined,
  };

  let controller: ReadableStreamDefaultController<ChatUiMessageChunk> | null = null;
  slot.stream = new ReadableStream<ChatUiMessageChunk>({
    start: streamController => {
      controller = streamController;
    },
  });
  slot.enqueue = chunk => {
    if (slot.closed || !controller) return;
    try {
      controller.enqueue(chunk);
    } catch {
      slot.closed = true;
    }
  };
  slot.close = () => {
    if (slot.closed || !controller) return;
    slot.closed = true;
    try {
      controller.close();
    } catch {
    }
  };
  slot.fail = error => {
    if (slot.closed || !controller) return;
    slot.closed = true;
    try {
      controller.error(error);
    } catch {
    }
  };

  return slot;
};

const isTerminalChunkType = (type: string): boolean =>
  type === 'finish' || type === 'abort' || type === 'error';

export type IpcChatTransport = UiChatTransport & {
  
  expectFollowUpStream: () => void;
  
  disarmFollowUpStream: () => void;
  
  closeFollowUpStream: () => void;
  
  detachActiveStream: () => void;
  
  getBoundThreadId: () => string | null;
  
  onChunk: (tap: ChunkTap) => () => void;
  
  getRecentTraces: () => string[];
};

export const createIpcChatTransport = (deps: {
  electronAPI: Pick<ElectronApi, 'chat'>;
}): IpcChatTransport => {
  let active: InboundSlot | null = null;
  let resume: InboundSlot | null = null;
  let resumeHandedOff = false;
  let boundThreadId: string | null = null;

  const taps = new Set<ChunkTap>();

  const feed = (slot: InboundSlot, chunk: ChatUiMessageChunk) => {
    slot.bound = true;
    for (const tap of taps) tap(chunk);
    slot.trace.push(describeChunk(chunk));
    if (slot.trace.length > 120) slot.trace.shift();
    slot.enqueue(chunk);
    if (isTerminalChunkType(chunk.type)) {
      slot.close();
      if (active === slot) active = null;
    }
  };

  deps.electronAPI.chat.onUiChunk(raw => {
    if (!isObjectRecord(raw) || typeof raw.type !== 'string') return;
    const chunk = raw as unknown as ChatUiMessageChunk;

    if (chunk.type === 'start' && resume && !resume.closed) {
      const adopted = resume;
      active = adopted;
      feed(adopted, chunk);
      return;
    }
    if (active && (active.bound || chunk.type === 'start') && !active.closed) {
      feed(active, chunk);
    }
  });

  const transport: IpcChatTransport = {
    expectFollowUpStream() {
      resumeHandedOff = false;
      if (resume && !resume.closed) return;
      resume = createInboundSlot();
    },

    disarmFollowUpStream() {
      resume?.close();
      resume = null;
    },

    closeFollowUpStream() {
      resume?.close();
      if (active === resume) active = null;
    },

    detachActiveStream() {
      active?.close();
      active = null;
      resume?.close();
      resume = null;
    },

    getBoundThreadId: () => boundThreadId,

    getRecentTraces: () => [
      ...(active ? [`${active.bound ? 'active' : 'unbound'}: ${active.trace.join(' | ')}`] : []),
      ...(resume && resume !== active ? [`resume: ${resume.trace.join(' | ')}`] : []),
    ],

    onChunk(tap) {
      taps.add(tap);
      return () => taps.delete(tap);
    },

    async sendMessages({ messages, body, abortSignal }) {
      active?.close();
      active = null;
      resume?.close();
      resume = null;
      resumeHandedOff = false;

      const slot = createInboundSlot();
      active = slot;
      if (isObjectRecord(body) && typeof body.threadId === 'string' && body.threadId.trim()) {
        boundThreadId = body.threadId;
      }

      const invocation = {
        ...(body as Partial<ChatInvocationOptions>),
        messages: clonePlainData(messages),
      } as ChatInvocationOptions;

      if (abortSignal) {
        const onAbort = (): void => {
          void deps.electronAPI.chat.stopStream().catch((): void => undefined);
        };
        if (abortSignal.aborted) {
          onAbort();
        } else {
          abortSignal.addEventListener('abort', onAbort, { once: true });
        }
      }

      void deps.electronAPI.chat
        .stream(invocation)
        .then(result => {
          if (result?.success === false) {
            slot.fail(new Error(result.error || 'Chat stream failed'));
            if (active === slot) active = null;
            return;
          }
          slot.close();
          if (active === slot) active = null;
        })
        .catch(error => {
          transportLogger.event({
            level: 'error',
            event: 'chat.transport.stream',
            outcome: 'failed',
            error,
          });
          slot.fail(error instanceof Error ? error : new Error(String(error)));
          if (active === slot) active = null;
        });

      return slot.stream;
    },

    async reconnectToStream() {
      if (resumeHandedOff) return null;
      if (resume) {
        resumeHandedOff = true;
        return resume.stream;
      }
      return null;
    },
  };

  return transport;
};
