import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
const summarize = vi.hoisted(() => vi.fn());
const callPiChatMock = vi.hoisted(() => vi.fn());

vi.mock('@iki/backend/provider/llm/factory', async importOriginal => ({
  ...(await importOriginal<typeof import('@iki/backend/provider/llm/factory')>()),
  resolvePersonaPrompt: () => 'test persona',
  getProviderConfig: () => ({
    type: 'openai',
    apiKey: 'key-test',
    baseURL: 'http://127.0.0.1:9/v1',
  }),
}));

vi.mock('@iki/backend/provider/llm/pi_adapter', async importOriginal => ({
  ...(await importOriginal<typeof import('@iki/backend/provider/llm/pi_adapter')>()),
  callPiChat: callPiChatMock,
}));

vi.mock('@iki/backend/runtimes/thread_summary', () => ({ generateThreadSummary: summarize }));
vi.mock('@iki/backend/logger', () => ({
  createLogger: () => ({
    event: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  }),
}));
import { startPiTurnHarness } from '@iki/backend/agent/harness';
import { createScriptedPiChat } from '@iki/backend/agent/testing/scripted_pi';
import { createTool } from '@iki/backend/tools';

const oldText = 'historical observation '.repeat(500);
const initialHistory = [
  { role: 'system' as const, content: 'Keep all workspace instructions.' },
  { role: 'user' as const, content: 'Earlier task' },
  { role: 'assistant' as const, content: oldText },
];
const harnessFor = () =>
  startPiTurnHarness({
    providerType: 'faux',
    model: 'test',
    systemPrompt: 'You are a coding agent.',
    enableTools: true,
    enabledToolNames: [],
    availableSkillIds: [],
    guardActive: false,
    maxIterations: 4,
    maxInputTokens: 300,
  });

describe('model-step context budget', () => {
  it('summarizes before inference, keeps instructions and raw history, and reuses the projection across SDK steps', async () => {
    summarize.mockReset().mockResolvedValue({ summary: 'Earlier decision: preserve the API.' });
    callPiChatMock.mockImplementation(
      createScriptedPiChat([
        [
          { kind: 'toolCall', toolName: 'probe', args: {} },
          { kind: 'done', reason: 'toolUse' },
        ],
        [
          { kind: 'text', text: 'done' },
          { kind: 'done', reason: 'stop' },
        ],
      ])
    );
    const call = callPiChatMock;
    const harness = harnessFor();
    for await (const _event of harness.turn({
      prompt: 'Current task',
      history: initialHistory,
      toolsOverride: [
        createTool({
          name: 'probe',
          type: 'function',
          description: 'Probe',
          paramSchema: z.object({}),
          handler: async () => 'result',
        }),
      ],
    })) {
      /* drain the stream; assertions follow */
    }
    expect(summarize).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(summarize.mock.calls[0][0])).toContain(oldText);
    expect((summarize.mock.calls[0][0] as Record<string, unknown>).cachePrefix).toBeUndefined();
    expect(call).toHaveBeenCalledTimes(2);
    for (const [, request] of call.mock.calls) {
      const rendered = JSON.stringify(request);
      expect(rendered).toContain('Keep all workspace instructions.');
      expect(rendered).toContain('preserve the API');
      expect(rendered).toContain('Current task');
      expect(rendered).not.toContain(oldText);
    }
    expect(JSON.stringify(harness.getHistory())).toContain(oldText);
  });

  it('does not invoke the model or lose history if summarization fails', async () => {
    summarize.mockReset().mockResolvedValue(null);
    callPiChatMock.mockImplementation(
      createScriptedPiChat([[{ kind: 'text', text: 'must not run' }, { kind: 'done' }]])
    );
    const harness = harnessFor();
    const consume = async () => {
      for await (const _event of harness.turn({
        prompt: 'Current task',
        history: initialHistory,
        toolsOverride: [],
      })) {
        /* drain the stream; the throw is asserted below */
      }
    };
    await expect(consume()).rejects.toThrow('Context compaction failed');
    expect(callPiChatMock).not.toHaveBeenCalled();
    expect(JSON.stringify(harness.getHistory())).toContain(oldText);
  });
});
