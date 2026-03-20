import { describe, expect, it, vi } from 'vitest';

import type { AgentResult, ConversationRunner } from '../../../../src/core/agent';
import { createToolLoopRunner } from '../../../../src/main/services/chat/chat_tool_loop';

const createAsyncGenerator = (chunks: string[], result: AgentResult) =>
  (async function* () {
    for (const chunk of chunks) {
      yield chunk;
    }
    return result;
  })();

const createConversationRunner = (stream: AsyncGenerator<string, AgentResult, unknown>) =>
  ({
    generate: vi.fn(),
    registerTool: vi.fn(),
    stream: vi.fn().mockReturnValue(stream),
  }) as unknown as ConversationRunner;

const createUiChunkEmitter = () => ({
  messageId: 'msg_1',
  emitTextDelta: vi.fn(),
  emitToolEvent: vi.fn(),
  emitMemoryRetrieval: vi.fn(),
  emitContextReport: vi.fn(),
  finish: vi.fn(),
  abort: vi.fn(),
  error: vi.fn(),
});

describe('tool loop runner', () => {
  it('streams text and finishes when no approvals are required', async () => {
    const registerApprovalBatch = vi.fn();
    const runner = createToolLoopRunner({ registerApprovalBatch });
    const agentResult: AgentResult = {
      response: 'Final text',
      iterations: 1,
      usage: {
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        reasoningTokens: 0,
        estimatedCostUsd: 0,
      },
    };
    const conversationRunner = createConversationRunner(
      createAsyncGenerator(['Hello ', 'world'], agentResult)
    );
    const uiChunkEmitter = createUiChunkEmitter();
    const webContents = { id: 1, send: vi.fn() };

    const result = await runner.stream({
      runner: conversationRunner,
      webContents,
      history: [{ role: 'system', content: 'history' }],
      prompt: 'hi',
      uiChunkEmitter,
    });

    expect(result.awaitingApproval).toBe(false);
    expect(result.usage?.totalTokens).toBe(15);
    expect(uiChunkEmitter.emitTextDelta).toHaveBeenCalledTimes(2);
    expect(uiChunkEmitter.emitTextDelta).toHaveBeenNthCalledWith(1, 'Hello ');
    expect(uiChunkEmitter.emitTextDelta).toHaveBeenNthCalledWith(2, 'world');
    expect(uiChunkEmitter.finish).toHaveBeenCalledTimes(1);
    expect(registerApprovalBatch).not.toHaveBeenCalled();
  });

  it('registers approval batch and does not finish when approval is needed', async () => {
    const registerApprovalBatch = vi.fn();
    const runner = createToolLoopRunner({ registerApprovalBatch });
    const agentResult: AgentResult = {
      response: '',
      iterations: 1,
      usage: {
        inputTokens: 2,
        outputTokens: 1,
        totalTokens: 3,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        reasoningTokens: 0,
        estimatedCostUsd: 0,
      },
      toolApprovalRequests: [
        {
          approvalId: 'approval_1',
          toolCall: { toolName: 'web', args: {} },
        },
      ],
    };
    const conversationRunner = createConversationRunner(createAsyncGenerator([], agentResult));
    const uiChunkEmitter = createUiChunkEmitter();
    const webContents = { id: 2, send: vi.fn() };

    const result = await runner.stream({
      runner: conversationRunner,
      webContents,
      history: [{ role: 'system', content: 'history' }],
      prompt: 'go',
      uiChunkEmitter,
    });

    expect(result.awaitingApproval).toBe(true);
    expect(result.usage?.totalTokens).toBe(3);
    expect(registerApprovalBatch).toHaveBeenCalledWith(agentResult.toolApprovalRequests, {
      runner: conversationRunner,
      webContents,
    });
    expect(uiChunkEmitter.finish).not.toHaveBeenCalled();
  });

  it('aborts when cancelled during streaming', async () => {
    const registerApprovalBatch = vi.fn();
    const runner = createToolLoopRunner({ registerApprovalBatch });
    const agentResult: AgentResult = { response: 'Final text', iterations: 1 };
    const conversationRunner = createConversationRunner(
      createAsyncGenerator(['Hello ', 'world'], agentResult)
    );
    const uiChunkEmitter = createUiChunkEmitter();
    const webContents = { id: 3, send: vi.fn() };
    let cancelChecks = 0;

    const result = await runner.stream({
      runner: conversationRunner,
      webContents,
      history: [{ role: 'system', content: 'history' }],
      prompt: 'hi',
      uiChunkEmitter,
      shouldCancel: () => {
        cancelChecks += 1;
        return cancelChecks > 1;
      },
    });

    expect(result.awaitingApproval).toBe(false);
    expect(result.cancelled).toBe(true);
    expect(uiChunkEmitter.emitTextDelta).toHaveBeenCalledTimes(1);
    expect(uiChunkEmitter.emitTextDelta).toHaveBeenNthCalledWith(1, 'Hello ');
    expect(uiChunkEmitter.abort).toHaveBeenCalledTimes(1);
    expect(uiChunkEmitter.finish).not.toHaveBeenCalled();
    expect(registerApprovalBatch).not.toHaveBeenCalled();
    expect(conversationRunner.stream).toHaveBeenCalledWith({
      history: [{ role: 'system', content: 'history' }],
      prompt: 'hi',
      approvalResponses: undefined,
      onStreamPart: undefined,
      abortSignal: undefined,
    });
  });
});
