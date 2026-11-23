import { describe, expect, it } from 'vitest';
import { normalizeContext } from '@earendil-works/pi-ai';
import { convertMessages } from '@earendil-works/pi-ai/api/openai-completions';
import { reduceChunkLogToMessage } from '@iki/llm/message/ui_chunk_reducer';
import { toModelInputMessages } from '@iki/llm/message/ui_messages';
import { normalizeToolOutput, toolResultText } from '@iki/llm/message/model_history';
import {
  buildPiModel,
  projectHistoryToPiContext,
  shouldUseCacheRetention,
} from '@iki/llm-pi-ai/pi_adapter';
import type { ChatUiChunk, ChatUiMessage } from '@iki/llm/message/ui_protocol';

describe('multi-turn KV-cache prefix stability', () => {
  it('replays a multi-step tool turn as alternating assistant/tool wire messages without double-wrapping tool outputs', async () => {
    const toolOut1 = normalizeToolOutput({ stdout: 'brew 7.0.16', stderr: '' });
    const toolOut2 = normalizeToolOutput({ stdout: 'upgraded 5 packages', stderr: '' });

    // Simulate a 3-step turn persisted via ui_chunk_reducer:
    //   step 0: text1 + shell(tc1) -> toolOut1
    //   step 1: text2 + shell(tc2) -> toolOut2
    //   step 2: text3 (final answer)
    const chunks: ChatUiChunk[] = [
      { type: 'start', messageId: 'asst_1' },
      { type: 'reasoning-start', id: 'asst_1-r' },
      { type: 'reasoning-delta', id: 'asst_1-r', delta: 'plan step 1' },
      { type: 'reasoning-end', id: 'asst_1-r' },
      { type: 'text-start', id: 'asst_1-t0' },
      { type: 'text-delta', id: 'asst_1-t0', delta: 'Checking brew...' },
      { type: 'text-end', id: 'asst_1-t0' },
      {
        type: 'tool-input-available',
        toolCallId: 'tc_1',
        toolName: 'bash',
        input: { command: 'brew update' },
        stepIndex: 0,
        dynamic: true,
      },
      {
        type: 'tool-output-available',
        toolCallId: 'tc_1',
        toolName: 'bash',
        output: toolOut1,
        dynamic: true,
      },
      { type: 'text-start', id: 'asst_1-t1' },
      { type: 'text-delta', id: 'asst_1-t1', delta: 'Upgrading now...' },
      { type: 'text-end', id: 'asst_1-t1' },
      {
        type: 'tool-input-available',
        toolCallId: 'tc_2',
        toolName: 'bash',
        input: { command: 'brew upgrade' },
        stepIndex: 1,
        dynamic: true,
      },
      {
        type: 'tool-output-available',
        toolCallId: 'tc_2',
        toolName: 'bash',
        output: toolOut2,
        dynamic: true,
      },
      { type: 'text-start', id: 'asst_1-t2' },
      { type: 'text-delta', id: 'asst_1-t2', delta: 'All upgraded.' },
      { type: 'text-end', id: 'asst_1-t2' },
      { type: 'finish' },
    ];

    const persistedAssistant = reduceChunkLogToMessage(chunks, { messageId: 'asst_1' });
    expect(persistedAssistant).not.toBeNull();

    const uiHistory: ChatUiMessage[] = [
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'upgrade brew' }] },
      persistedAssistant!,
      { id: 'u2', role: 'user', parts: [{ type: 'text', text: 'thanks' }] },
    ];

    const replayedModelMessages = await toModelInputMessages(uiHistory);
    expect(replayedModelMessages.map(m => m.role)).toEqual([
      'user',
      'assistant',
      'tool',
      'assistant',
      'tool',
      'assistant',
      'user',
    ]);

    const model = buildPiModel({
      id: 'workbuddy/hy4flash-free',
      providerType: 'openai-compatible',
      baseUrl: 'http://127.0.0.1:3425/v1',
      api: 'openai-completions',
      contextWindow: 128000,
      maxTokens: 4096,
    });

    const projected = projectHistoryToPiContext(
      replayedModelMessages,
      model.id,
      'openai-compatible'
    );
    const wire = convertMessages(
      model as never,
      normalizeContext({ systemPrompt: 'STATIC_SYS', messages: projected.messages as never }),
      model.compat as never
    ) as Array<{ role: string; content?: unknown; tool_calls?: unknown[]; tool_call_id?: string }>;

    expect(wire.map(m => m.role)).toEqual([
      'system',
      'user',
      'assistant',
      'tool',
      'assistant',
      'tool',
      'assistant',
      'user',
    ]);
    // Step 0 assistant has only text1 + tc_1
    expect(wire[2].content).toBe('Checking brew...');
    expect(wire[2].tool_calls).toHaveLength(1);
    // Tool result must match live toolResultText(toolOut1) byte-for-byte (NOT double-wrapped)
    expect(wire[3].tool_call_id).toBe('tc_1');
    expect(wire[3].content).toBe(toolResultText(toolOut1));
    expect(String(wire[3].content)).not.toContain('"type":"json"');
    // Step 1 assistant has only text2 + tc_2
    expect(wire[4].content).toBe('Upgrading now...');
    expect(wire[4].tool_calls).toHaveLength(1);
    expect(wire[5].tool_call_id).toBe('tc_2');
    expect(wire[5].content).toBe(toolResultText(toolOut2));
    // Step 2 final assistant text comes AFTER tool results, before the next user message
    expect(wire[6].content).toBe('All upgraded.');
    expect(wire[6].tool_calls).toBeUndefined();
    expect(wire[7].content).toBe('thanks');
  });

  it('keeps parallel tool calls in one step together while splitting back-to-back tool-only steps by stepIndex', async () => {
    const uiHistory: ChatUiMessage[] = [
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'run commands' }] },
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          {
            type: 'dynamic-tool',
            toolCallId: 'p1',
            toolName: 'bash',
            stepIndex: 0,
            state: 'output-available',
            input: { command: 'echo 1' },
            output: { type: 'json', value: { stdout: '1' } },
          },
          {
            type: 'dynamic-tool',
            toolCallId: 'p2',
            toolName: 'bash',
            stepIndex: 0,
            state: 'output-available',
            input: { command: 'echo 2' },
            output: { type: 'json', value: { stdout: '2' } },
          },
          {
            type: 'dynamic-tool',
            toolCallId: 's1',
            toolName: 'bash',
            stepIndex: 1,
            state: 'output-available',
            input: { command: 'echo 3' },
            output: { type: 'json', value: { stdout: '3' } },
          },
        ],
      },
    ];

    const replayed = await toModelInputMessages(uiHistory);
    expect(replayed.map(m => m.role)).toEqual(['user', 'assistant', 'tool', 'assistant', 'tool']);
    expect(Array.isArray(replayed[1].content) ? replayed[1].content : []).toHaveLength(2);
    expect(Array.isArray(replayed[2].content) ? replayed[2].content : []).toHaveLength(2);
    expect(Array.isArray(replayed[3].content) ? replayed[3].content : []).toHaveLength(1);
    expect(Array.isArray(replayed[4].content) ? replayed[4].content : []).toHaveLength(1);
  });

  it('enables session affinity headers and cache retention for compatible providers', () => {
    const openaiCompat = buildPiModel({
      id: 'workbuddy/hy4flash-free',
      providerType: 'openai-compatible',
      baseUrl: 'http://127.0.0.1:3425/v1',
      api: 'openai-completions',
      contextWindow: 128000,
      maxTokens: 4096,
    });
    expect((openaiCompat.compat as { sendSessionAffinityHeaders?: boolean }).sendSessionAffinityHeaders).toBe(true);

    const anthropic = buildPiModel({
      id: 'claude-sonnet-4-6',
      providerType: 'anthropic-compatible',
      baseUrl: 'http://127.0.0.1:3425/v1',
      api: 'anthropic-messages',
      contextWindow: 200000,
      maxTokens: 8192,
    });
    expect(shouldUseCacheRetention(anthropic)).toBe(true);
    expect((anthropic.compat as { sendSessionAffinityHeaders?: boolean }).sendSessionAffinityHeaders).toBe(true);
  });
});
