import { describe, expect, it, vi } from 'vitest';

import { createChatInstance } from '../../../../packages/desktop/src/renderer/modules/chat/chat_instance';

type Chunk = Record<string, unknown>;

const MSG = 'assistant_1';

/**
 * Reproduces the #71 repeat-approval chunk sequences through the real
 * renderer chat runtime. Timing model mirrors the wire: the backend pushes
 * resume chunks over the shared IPC channel DURING the approveTool call and
 * resolves the IPC afterwards; the approval controller arms the follow-up
 * slot before the call and consumes the buffered stream after it.
 */
const createElectronApiStub = (onApprove: (emit: (chunk: Chunk) => void) => void) => {
  const listeners = new Set<(chunk: unknown) => void>();
  let resolveStream: ((result: unknown) => void) | null = null;

  const chat = {
    onUiChunk: (callback: (chunk: unknown) => void) => {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
    stream: () =>
      new Promise(resolve => {
        resolveStream = resolve;
      }),
    approveTool: async () => {
      // The backend pushes the whole resumed segment before the IPC resolves.
      onApprove(chunk => {
        for (const listener of listeners) listener(chunk);
      });
      return { success: true, awaitingApproval: true };
    },
    stopStream: async () => ({ success: true }),
  };

  return {
    electronAPI: { chat },
    emit(chunk: Chunk) {
      for (const listener of listeners) listener(chunk);
    },
    finishStream(result: unknown) {
      resolveStream?.(result);
      resolveStream = null;
    },
  };
};

const feedPause1 = (emit: (chunk: Chunk) => void) => {
  emit({ type: 'start', messageId: MSG });
  emit({
    type: 'tool-input-available',
    toolCallId: 'call_1',
    toolName: 'write_file',
    input: { path: 'a.txt' },
    dynamic: true,
  });
  emit({
    type: 'tool-approval-request',
    approvalId: 'appr_1',
    toolCallId: 'call_1',
    toolCall: { toolName: 'write_file', toolCallId: 'call_1', args: { path: 'a.txt' } },
  });
};

const feedResume1 = (emit: (chunk: Chunk) => void) => {
  // Backend resume #1: start re-addresses the same message, the approved
  // tool's result arrives (with the tolerant re-seed), the model replies and
  // requests a second approval — no terminal chunk (blocked again).
  emit({ type: 'start', messageId: MSG });
  emit({ type: 'tool-input-available', toolCallId: 'call_1', toolName: 'write_file', input: {}, dynamic: true });
  emit({ type: 'tool-output-available', toolCallId: 'call_1', output: 'ok' });
  emit({ type: 'text-start', id: `${MSG}-t0` });
  emit({ type: 'text-delta', id: `${MSG}-t0`, delta: 'continuing' });
  emit({ type: 'text-end', id: `${MSG}-t0` });
  emit({ type: 'tool-input-available', toolCallId: 'call_2', toolName: 'write_file', input: { path: 'b.txt' }, dynamic: true });
  emit({ type: 'tool-approval-request', approvalId: 'appr_2', toolCallId: 'call_2', toolCall: { toolName: 'write_file', toolCallId: 'call_2', args: { path: 'b.txt' } } });
};

describe('chat runtime repeat-approval chunk sequences (#71)', () => {
  const buildInstance = () => {
    let approveHandler: ((emit: (chunk: Chunk) => void) => void) | null = null;
    const electronApi = createElectronApiStub(emit => approveHandler?.(emit));
    const onError = vi.fn();
    const instance = createChatInstance({
      electronAPI: electronApi.electronAPI as never,
      generateId: (() => {
        let n = 0;
        return () => `gen_${++n}`;
      }) as never,
      getCurrentThreadId: () => 'thread_1',
    });
    instance.chat.onError = onError as never;
    return {
      electronApi,
      instance,
      onError,
      setApproveHandler: (fn: typeof approveHandler) => {
        approveHandler = fn;
      },
    };
  };

  const allParts = (instance: ReturnType<typeof createChatInstance>) =>
    instance.messageStore.messages
      .flatMap(message => message.parts ?? [])
      .map(
        part =>
          `${(part as { type: string }).type}:${(part as { toolCallId?: string }).toolCallId ?? ''}`
      );

  it('processes an approval resume that pauses again on a second card', async () => {
    const { electronApi, instance, onError, setApproveHandler } = buildInstance();
    setApproveHandler(feedResume1);

    const sendPromise = instance.chat.sendMessage({ text: 'write files' } as never);
    await Promise.resolve();
    feedPause1(electronApi.emit);
    electronApi.finishStream({ success: true, awaitingApproval: true });
    await sendPromise;

    // Approve card 1 through the real controller path; the stub pushes the
    // whole resume #1 segment during the approveTool call.
    const messages = instance.messageStore.messages;
    const approvalPart = messages
      .flatMap(message => message.parts ?? [])
      .find(
        part =>
          (part as { type?: string }).type === 'dynamic-tool' &&
          ((part as { approval?: { id?: string } }).approval?.id === 'appr_1' ||
            (part as { toolCallId?: string }).toolCallId === 'call_1')
      );
    expect(approvalPart).toBeDefined();

    await instance.handleToolApproval(messages[1]!, approvalPart, true);
    // The controller resumes the stream fire-and-forget; let the Chat drain
    // the buffered segment before asserting.
    await new Promise(resolve => setTimeout(resolve, 0));
    await new Promise(resolve => setTimeout(resolve, 0));

    const parts = allParts(instance).join(',');
    expect(onError).not.toHaveBeenCalled();
    // Same-message continuation: the resume applied to assistant_1, both
    // tool exchanges and the reply text are on the one message.
    const assistant = instance.messageStore.messages.find(m => m.id === MSG);
    expect(assistant).toBeDefined();
    const assistantParts = allParts({ messageStore: { messages: [assistant!] } } as never).join(',');
    expect(assistantParts).toContain('call_1');
    expect(assistantParts).toContain('call_2');
    expect(assistantParts).toContain('text:');
    expect(
      (assistant!.parts ?? []).some(part => (part as { type?: string }).type === 'text')
    ).toBe(true);
  });

  it('survives the original stream closing after resume chunks were pushed', async () => {
    // Race shape: the follow-up slot is armed and the whole resume segment is
    // fed BEFORE the original invoke's result closes the original slot —
    // adoption must not lose the resume.
    const { electronApi, instance, onError } = buildInstance();

    const sendPromise = instance.chat.sendMessage({ text: 'write files' } as never);
    await Promise.resolve();
    feedPause1(electronApi.emit);

    instance.transport.expectFollowUpStream();
    feedResume1(electronApi.emit);
    electronApi.finishStream({ success: true, awaitingApproval: true });
    instance.transport.closeFollowUpStream();
    await sendPromise;
    await instance.chat.resumeStream?.();
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(onError).not.toHaveBeenCalled();
    expect(allParts(instance).join(',')).toContain('call_2');
  });
});
