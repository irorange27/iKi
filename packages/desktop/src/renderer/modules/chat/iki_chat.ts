/**
 * The renderer's chat state machine.
 *
 * Replaces the AI SDK's `AbstractChat` (ADR 009). The SDK version carried a
 * large generic surface (`ChatState`, `ChatTransport`, part accumulation) that
 * iKi used for exactly three things: append the user message, fold the incoming
 * chunk stream into the assistant message, and expose `status`/`error`. This
 * class does those three, on iKi's own chunk protocol (`ChatUiChunk`), with the
 * same externally observable behaviour.
 *
 * Streaming model: one `sendMessage` call at a time. The transport hands back a
 * `ReadableStream` of chunks; they are applied as they arrive so the UI updates
 * progressively, and the settle callback fires once the stream ends.
 */
import type {
  ChatUiChunk,
  ChatUiMessage,
  UiChatStatus,
  UiChatTransport,
} from '@iki/backend/message/ui_protocol';

import { applyChatUiChunk } from './chat_chunk_apply';

export type ChatFinishInfo = {
  message: ChatUiMessage;
  isAbort: boolean;
  isError: boolean;
};

/**
 * The state the chat writes into. Index-addressed because the renderer's store
 * keeps ONE array whose identity the view subscribes to; `replaceMessage`
 * rewrites a slot in place so the same array reference stays live.
 */
export type ChatStateAdapter = {
  status: UiChatStatus;
  error: Error | undefined;
  messages: ChatUiMessage[];
  pushMessage: (message: ChatUiMessage) => void;
  popMessage: () => void;
  replaceMessage: (index: number, message: ChatUiMessage) => void;
  /**
   * Identity hop used by callers that want the LIVE value as-is (the store's
   * array is mutated in place, so a snapshot copy would be stale). Kept in the
   * contract because `chat_instance` exposes it in its return value.
   */
  snapshot: (value: ChatUiMessage[]) => ChatUiMessage[];
};

export type IkiChatOptions = {
  transport: UiChatTransport;
  state: ChatStateAdapter;
  generateId: () => string;
  chatId: string;
  onError?: (error: Error) => void;
  onFinish?: (info: ChatFinishInfo) => void;
};

const EMPTY_ASSISTANT = (id: string): ChatUiMessage => ({ id, role: 'assistant', parts: [] });

export class IkiChat {
  private abortController: AbortController | null = null;

  constructor(private readonly options: IkiChatOptions) {}

  get status(): UiChatStatus {
    return this.options.state.status;
  }

  get error(): Error | undefined {
    return this.options.state.error;
  }

  /** Live message list. Same array the store mutates in place. */
  get messages(): ChatUiMessage[] {
    return this.options.state.messages;
  }

  /** Append a user message and stream its answer. Resolves when the turn settles. */
  async sendMessage(message: ChatUiMessage, options: { body?: Record<string, unknown> } = {}): Promise<void> {
    const { transport, state, chatId } = this.options;

    state.pushMessage(message);
    state.error = undefined;
    state.status = 'submitted';

    const assistantId = this.options.generateId();
    let assistant: ChatUiMessage = EMPTY_ASSISTANT(assistantId);
    state.pushMessage(assistant);
    const assistantIndex = state.messages.length - 1;

    this.abortController = new AbortController();
    const { signal } = this.abortController;

    let isError = false;
    try {
      const stream = await transport.sendMessages({
        chatId,
        messages: state.messages.filter((_, index) => index !== assistantIndex),
        ...(options.body ? { body: options.body } : {}),
        abortSignal: signal,
      });
      state.status = 'streaming';

      for await (const chunk of readChunks(stream)) {
        assistant = applyChatUiChunk(assistant, chunk);
        state.replaceMessage(assistantIndex, { ...assistant, parts: [...assistant.parts] });
        if (chunk.type === 'error') {
          isError = true;
          state.error = new Error(chunk.errorText);
        }
      }
    } catch (error) {
      isError = true;
      const normalized = error instanceof Error ? error : new Error(String(error));
      state.error = normalized;
      this.options.onError?.(normalized);
    } finally {
      state.status = isError ? 'error' : 'ready';
      this.abortController = null;
      this.options.onFinish?.({
        message: assistant,
        isAbort: signal.aborted,
        isError,
      });
    }
  }

  /**
   * Record the user's decision on a pending approval, in place on the tool part
   * that asked for it.
   *
   * `AbstractChat` owned this before; the only observable effect iKi relied on
   * is the part moving out of `approval-requested`, so the card stops asking
   * and the resumed segment can attach to the same call.
   */
  addToolApprovalResponse(response: { id: string; approved: boolean }): void {
    const messages = this.options.state.messages;
    for (const message of messages) {
      for (const part of message.parts) {
        if (part.type !== 'dynamic-tool') continue;
        const tool = part as import('@iki/backend/message/ui_protocol').UiDynamicToolPart;
        if (tool.approval?.id !== response.id) continue;
        tool.state = 'approval-responded';
        tool.approval = { id: response.id, approved: response.approved };
      }
    }
  }

  /** Abort the in-flight turn, if any. */
  stop(): void {
    this.abortController?.abort();
  }

  /**
   * Adopt a stream the backend pushed without a matching invoke (the approval
   * resume). Mirrors `sendMessage` but appends no user message.
   */
  async resumeStream(): Promise<void> {
    const { transport, state, chatId } = this.options;
    if (!transport.reconnectToStream) return;

    const stream = await transport.reconnectToStream({ chatId });
    if (!stream) return;

    state.error = undefined;
    state.status = 'streaming';

    const assistantId = this.options.generateId();
    let assistant: ChatUiMessage = EMPTY_ASSISTANT(assistantId);
    state.pushMessage(assistant);
    const assistantIndex = state.messages.length - 1;

    this.abortController = new AbortController();
    let isError = false;
    try {
      for await (const chunk of readChunks(stream)) {
        assistant = applyChatUiChunk(assistant, chunk);
        state.replaceMessage(assistantIndex, { ...assistant, parts: [...assistant.parts] });
        if (chunk.type === 'error') {
          isError = true;
          state.error = new Error(chunk.errorText);
        }
      }
    } catch (error) {
      isError = true;
      const normalized = error instanceof Error ? error : new Error(String(error));
      state.error = normalized;
      this.options.onError?.(normalized);
    } finally {
      state.status = isError ? 'error' : 'ready';
      this.abortController = null;
      this.options.onFinish?.({ message: assistant, isAbort: false, isError });
    }
  }
}

/** Iterate a ReadableStream with a for-await, releasing the reader either way. */
async function* readChunks(stream: ReadableStream<ChatUiChunk>): AsyncGenerator<ChatUiChunk> {
  const reader = stream.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      if (value) yield value;
    }
  } finally {
    reader.releaseLock();
  }
}
