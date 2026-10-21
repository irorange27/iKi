
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

export type ChatStateAdapter = {
  status: UiChatStatus;
  error: Error | undefined;
  messages: ChatUiMessage[];
  pushMessage: (message: ChatUiMessage) => void;
  popMessage: () => void;
  replaceMessage: (index: number, message: ChatUiMessage) => void;
  
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

const findPausedAssistant = (
  messages: readonly ChatUiMessage[]
): { index: number; message: ChatUiMessage } | null => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index] as ChatUiMessage;
    if (message.role !== 'assistant') continue;
    const paused = (message.parts ?? []).some(
      part =>
        part.type === 'dynamic-tool' &&
        ((part as { state?: string }).state === 'approval-requested' ||
          (part as { state?: string }).state === 'approval-responded')
    );
    if (paused) return { index, message };
  }
  return null;
};

export class IkiChat {
  private abortController: AbortController | null = null;

  constructor(private readonly options: IkiChatOptions) {}

  get status(): UiChatStatus {
    return this.options.state.status;
  }

  get error(): Error | undefined {
    return this.options.state.error;
  }

  
  get messages(): ChatUiMessage[] {
    return this.options.state.messages;
  }

  
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

  
  stop(): void {
    this.abortController?.abort();
  }

  
  async resumeStream(): Promise<void> {
    const { transport, state, chatId } = this.options;
    if (!transport.reconnectToStream) return;

    const stream = await transport.reconnectToStream({ chatId });
    if (!stream) return;

    state.error = undefined;
    state.status = 'streaming';

    const paused = findPausedAssistant(state.messages);
    let assistant: ChatUiMessage;
    let assistantIndex: number;
    if (paused) {
      assistantIndex = paused.index;
      assistant = {
        ...paused.message,
        parts: structuredClone(paused.message.parts ?? []),
      };
    } else {
      assistant = EMPTY_ASSISTANT(this.options.generateId());
      assistantIndex = state.messages.length;
      state.pushMessage(assistant);
    }

    this.abortController = new AbortController();
    let isError = false;
    try {
      for await (const chunk of readChunks(stream)) {
        if (chunk.type === 'start' && chunk.messageId) {
          const existing = state.messages.findIndex(entry => entry.id === chunk.messageId);
          if (existing >= 0 && existing !== assistantIndex) {
            const carried = assistant.parts;
            state.popMessage();
            assistantIndex = existing;
            const target = state.messages[existing] as ChatUiMessage;
            assistant = {
              ...target,
              parts: [
                ...structuredClone(target.parts ?? []),
                ...carried.filter(
                  part =>
                    !(target.parts ?? []).some(
                      prior =>
                        prior.type === 'dynamic-tool' &&
                        part.type === 'dynamic-tool' &&
                        (prior as { toolCallId?: string }).toolCallId ===
                          (part as { toolCallId?: string }).toolCallId
                    )
                ),
              ],
            };
          } else if (existing < 0) {
            assistant = { ...assistant, id: chunk.messageId };
          }
          continue;
        }
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
