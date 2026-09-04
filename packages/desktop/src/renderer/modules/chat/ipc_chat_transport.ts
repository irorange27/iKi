import type { ChatTransport } from 'ai';

import type { ChatInvocationOptions, ElectronApi } from '@iki/backend/types/electron_api';
import { clonePlainData } from '@iki/backend/utils/clone';
import { isObjectRecord } from '@iki/backend/utils/guards';
import { createLogger } from '../../logger';
import type { ChatUiMessage, ChatUiMessageChunk } from '@iki/backend/chat/message_parts';

const transportLogger = createLogger({ module: 'ipc_chat_transport' });

type ChunkTap = (chunk: ChatUiMessageChunk) => void;

/**
 * One in-flight wire stream. Chunks enqueue into the ReadableStream the Chat
 * consumes; `bound` flips when the stream's `start` chunk arrives — anything
 * enqueued before that belonged to a superseded stream.
 */
type InboundSlot = {
  stream: ReadableStream<ChatUiMessageChunk>;
  enqueue: (chunk: ChatUiMessageChunk) => void;
  close: () => void;
  fail: (error: Error) => void;
  bound: boolean;
  closed: boolean;
};

const createInboundSlot = (): InboundSlot => {
  const slot: InboundSlot = {
    bound: false,
    closed: false,
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
      // Already closed by the platform.
    }
  };
  slot.fail = error => {
    if (slot.closed || !controller) return;
    slot.closed = true;
    try {
      controller.error(error);
    } catch {
      // Already closed by the platform.
    }
  };

  return slot;
};

const isTerminalChunkType = (type: string): boolean =>
  type === 'finish' || type === 'abort' || type === 'error';

export type IpcChatTransport = ChatTransport<ChatUiMessage> & {
  /**
   * Arms a catch-all stream for chunks the backend pushes without a matching
   * `chat.stream` invoke — the tool-approval resume path. The next `start`
   * chunk binds it; `reconnectToStream` hands it to the Chat as a resume.
   */
  expectFollowUpStream: () => void;
  /** Drops the armed follow-up slot (e.g. when the approve IPC failed). */
  disarmFollowUpStream: () => void;
  /** Detaches the active stream and closes its reader side. */
  detachActiveStream: () => void;
  /** Thread id of the stream this transport is currently bound to. */
  getBoundThreadId: () => string | null;
  /** Observe every routed chunk (tool timing, todo-plan projection, …). */
  onChunk: (tap: ChunkTap) => () => void;
};

export const createIpcChatTransport = (deps: {
  electronAPI: Pick<ElectronApi, 'chat'>;
}): IpcChatTransport => {
  // Wire protocol over one shared IPC channel:
  //  - `active`  — the send/resume stream the Chat is currently consuming.
  //  - `resume`  — armed by expectFollowUpStream(); the next `start` chunk
  //                adopts it as the active stream (approval resume arrives
  //                without a matching send).
  // A chunk only feeds a slot that has seen its `start`; earlier chunks
  // belong to a superseded stream and are dropped (the stale-stream guard).
  let active: InboundSlot | null = null;
  let resume: InboundSlot | null = null;
  let resumeHandedOff = false;
  let boundThreadId: string | null = null;

  const taps = new Set<ChunkTap>();

  const feed = (slot: InboundSlot, chunk: ChatUiMessageChunk) => {
    slot.bound = true;
    for (const tap of taps) tap(chunk);
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

    detachActiveStream() {
      active?.close();
      active = null;
      resume?.close();
      resume = null;
    },

    getBoundThreadId: () => boundThreadId,

    onChunk(tap) {
      taps.add(tap);
      return () => taps.delete(tap);
    },

    async sendMessages({ messages, body, abortSignal }) {
      // A new send supersedes whatever was active or armed: their late
      // chunks no longer have a `start` binding and are dropped above.
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
          // The backend unwind emits the terminal `abort` chunk; nudge it in
          // case the run already ended without one.
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
          // The turn ended; if no terminal chunk closed the stream, close it
          // here so the SDK flushes.
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
        // Also covers the already-adopted (even already-closed) slot: the
        // buffered chunks replay when the Chat starts reading.
        resumeHandedOff = true;
        return resume.stream;
      }
      return null;
    },
  };

  return transport;
};
