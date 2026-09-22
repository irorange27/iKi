import { describe, expect, it, vi } from 'vitest';

import { createIpcChatTransport } from '../../../../packages/desktop/src/renderer/modules/chat/ipc_chat_transport';

type Chunk = Record<string, unknown>;

const createElectronApiStub = () => {
  const listeners = new Set<(chunk: unknown) => void>();
  const streamInvocations: Chunk[] = [];
  const stopStream = vi.fn(async () => ({ success: true }));

  const chat = {
    onUiChunk: (callback: (chunk: unknown) => void) => {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
    stream: async (options: Chunk) => {
      streamInvocations.push(options);
      return { success: true };
    },
    stopStream,
  };

  return {
    listeners,
    streamInvocations,
    stopStream,
    chat,
    electronAPI: { chat },
    emit(chunk: Chunk) {
      for (const listener of listeners) listener(chunk);
    },
  };
};

const readAll = async (stream: ReadableStream<unknown>): Promise<Chunk[]> => {
  const reader = stream.getReader();
  const chunks: Chunk[] = [];
  for (;;) {
    const result = await reader.read();
    if (result.done) break;
    chunks.push(result.value as Chunk);
  }
  return chunks;
};

describe('ipc_chat_transport', () => {
  it('feeds chunks bound to the active send stream and closes on finish', async () => {
    const electronApi = createElectronApiStub();
    const transport = createIpcChatTransport({ electronAPI: electronApi.electronAPI });

    const streamPromise = transport.sendMessages({
      chatId: 'chat_1',
      trigger: 'submit-message',
      messageId: undefined,
      messages: [],
      abortSignal: undefined,
      body: { threadId: 'thread_1', model: 'gpt-4.1' },
    });

    electronApi.emit({ type: 'start', messageId: 'assistant_1' });
    electronApi.emit({ type: 'text-start', id: 'assistant_1-t0' });
    electronApi.emit({ type: 'text-delta', id: 'assistant_1-t0', delta: 'hello' });
    electronApi.emit({ type: 'text-end', id: 'assistant_1-t0' });
    electronApi.emit({ type: 'finish' });

    const chunks = await readAll(await streamPromise);
    expect(chunks.map(chunk => chunk.type)).toEqual([
      'start',
      'text-start',
      'text-delta',
      'text-end',
      'finish',
    ]);
    expect(electronApi.streamInvocations[0]).toMatchObject({ threadId: 'thread_1' });
  });

  it('injects the conversation history from the chat state into the invocation', async () => {
    const electronApi = createElectronApiStub();
    const transport = createIpcChatTransport({ electronAPI: electronApi.electronAPI });
    const messages = [{ id: 'user_1', role: 'user', parts: [{ type: 'text', text: 'Hi' }] }];

    void transport.sendMessages({
      chatId: 'chat_1',
      trigger: 'submit-message',
      messageId: undefined,
      messages: messages as never,
      abortSignal: undefined,
      body: { threadId: 'thread_1' },
    });
    await vi.waitFor(() => expect(electronApi.streamInvocations).toHaveLength(1));

    expect(electronApi.streamInvocations[0]?.messages).toEqual(messages);
  });

  it('drops stale chunks from a superseded stream before its start binding', async () => {
    const electronApi = createElectronApiStub();
    const transport = createIpcChatTransport({ electronAPI: electronApi.electronAPI });

    const firstStream = transport.sendMessages({
      chatId: 'chat_1',
      trigger: 'submit-message',
      messageId: undefined,
      messages: [],
      abortSignal: undefined,
      body: { threadId: 'thread_1' },
    });
    electronApi.emit({ type: 'start', messageId: 'assistant_1' });
    await readAll(await firstStream);

    const secondStream = transport.sendMessages({
      chatId: 'chat_1',
      trigger: 'submit-message',
      messageId: undefined,
      messages: [],
      abortSignal: undefined,
      body: { threadId: 'thread_1' },
    });

    // Late chunk from the superseded first stream: no start binding → dropped.
    electronApi.emit({ type: 'finish' });

    electronApi.emit({ type: 'start', messageId: 'assistant_2' });
    electronApi.emit({ type: 'text-start', id: 'assistant_2-t0' });
    electronApi.emit({ type: 'finish' });

    const chunks = await readAll(await secondStream);
    expect(chunks.map(chunk => chunk.type)).toEqual(['start', 'text-start', 'finish']);
  });

  it('routes a follow-up stream (approval resume) and replays it through reconnectToStream', async () => {
    const electronApi = createElectronApiStub();
    const transport = createIpcChatTransport({ electronAPI: electronApi.electronAPI });

    transport.expectFollowUpStream();
    const reconnectPromise = transport.reconnectToStream({ chatId: 'chat_1' });

    electronApi.emit({ type: 'start', messageId: 'assistant_1' });
    electronApi.emit({ type: 'tool-output-available', toolCallId: 'call_1', output: 'ok' });
    electronApi.emit({ type: 'finish' });

    const reconnected = await reconnectPromise;
    expect(reconnected).not.toBeNull();
    const chunks = await readAll(reconnected as ReadableStream<Chunk>);
    expect(chunks.map(chunk => chunk.type)).toEqual([
      'start',
      'tool-output-available',
      'finish',
    ]);
  });

  it('replays chunks that arrived before reconnectToStream (resume-after-chunks ordering)', async () => {
    const electronApi = createElectronApiStub();
    const transport = createIpcChatTransport({ electronAPI: electronApi.electronAPI });

    transport.expectFollowUpStream();
    electronApi.emit({ type: 'start', messageId: 'assistant_1' });
    electronApi.emit({ type: 'text-start', id: 'assistant_1-t0' });
    electronApi.emit({ type: 'text-delta', id: 'assistant_1-t0', delta: 'resumed' });
    electronApi.emit({ type: 'finish' });

    const reconnected = await transport.reconnectToStream({ chatId: 'chat_1' });
    expect(reconnected).not.toBeNull();
    const chunks = await readAll(reconnected as ReadableStream<Chunk>);
    expect(chunks.map(chunk => chunk.type)).toEqual([
      'start',
      'text-start',
      'text-delta',
      'finish',
    ]);
  });

  it('returns null from reconnectToStream when nothing is armed', async () => {
    const electronApi = createElectronApiStub();
    const transport = createIpcChatTransport({ electronAPI: electronApi.electronAPI });

    expect(await transport.reconnectToStream({ chatId: 'chat_1' })).toBeNull();
  });

  it('ends a blocked follow-up segment on closeFollowUpStream and still replays its chunks', async () => {
    const electronApi = createElectronApiStub();
    const transport = createIpcChatTransport({ electronAPI: electronApi.electronAPI });

    transport.expectFollowUpStream();
    electronApi.emit({ type: 'start', messageId: 'assistant_1' });
    electronApi.emit({
      type: 'tool-input-available',
      toolCallId: 'call_2',
      toolName: 'shell',
      input: { command: 'ls' },
      dynamic: true,
    });
    electronApi.emit({
      type: 'tool-approval-request',
      approvalId: 'aitxt_2',
      toolCallId: 'call_2',
    });
    // A blocked resume (repeat approval) never emits finish/abort/error.
    transport.closeFollowUpStream();

    const reconnected = await transport.reconnectToStream({ chatId: 'chat_1' });
    expect(reconnected).not.toBeNull();
    const chunks = await readAll(reconnected as ReadableStream<Chunk>);
    expect(chunks.map(chunk => chunk.type)).toEqual([
      'start',
      'tool-input-available',
      'tool-approval-request',
    ]);
  });

  it('fails the stream when the send invoke reports a failure', async () => {
    const electronApi = createElectronApiStub();
    electronApi.electronAPI.chat.stream = async () => ({ success: false, error: 'rate limited' });
    const transport = createIpcChatTransport({ electronAPI: electronApi.electronAPI });

    const stream = await transport.sendMessages({
      chatId: 'chat_1',
      trigger: 'submit-message',
      messageId: undefined,
      messages: [],
      abortSignal: undefined,
      body: { threadId: 'thread_1' },
    });

    const reader = stream.getReader();
    await expect(reader.read()).rejects.toThrow('rate limited');
  });
});
