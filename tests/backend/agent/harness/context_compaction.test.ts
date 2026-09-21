import { expectConsoleErrorMatching } from '../../../setup/error_log_guard';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
const summarize = vi.hoisted(() => vi.fn());
vi.mock('@iki/backend/runtimes/thread_summary', () => ({ generateThreadSummary: summarize }));
vi.mock('@iki/backend/logger', () => ({ createLogger: () => ({ event: vi.fn(), warn: vi.fn(), debug: vi.fn(), info: vi.fn(), error: vi.fn() }) }));
import { startTurnHarness } from '@iki/backend/agent/harness';
import { FauxModelProvider, fauxText, fauxToolCall } from '@iki/backend/agent/testing/faux_model';
import { createTool } from '@iki/backend/tools';

const oldText = 'historical observation '.repeat(500);
const initialHistory = [
  { role: 'system' as const, content: 'Keep all workspace instructions.' },
  { role: 'user' as const, content: 'Earlier task' },
  { role: 'assistant' as const, content: oldText },
];
const harnessFor = (model: FauxModelProvider) => startTurnHarness({
  providerType: 'faux', model: 'test', modelFactory: () => model,
  systemPrompt: 'You are a coding agent.', enableTools: true,
  enabledToolNames: [], availableSkillIds: [], guardActive: false,
  maxIterations: 4, maxInputTokens: 300,
});

describe('model-step context budget', () => {
  it('summarizes before inference, keeps instructions and raw history, and reuses the projection across SDK steps', async () => {
    summarize.mockReset().mockResolvedValue({ summary: 'Earlier decision: preserve the API.' });
    const model = new FauxModelProvider([fauxToolCall('probe', {}), fauxText('done')]);
    const call = vi.spyOn(model, 'doStream');
    const harness = harnessFor(model);
    for await (const _event of harness.turn({
      prompt: 'Current task', history: initialHistory,
      toolsOverride: [createTool({ name: 'probe', type: 'function', description: 'Probe', paramSchema: z.object({}), handler: async () => 'result' })],
    })) { /* drain */ }
    expect(summarize).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(summarize.mock.calls[0][0])).toContain(oldText);
    expect(call).toHaveBeenCalledTimes(2);
    for (const [options] of call.mock.calls) {
      expect(JSON.stringify(options.prompt)).toContain('Keep all workspace instructions.');
      expect(JSON.stringify(options.prompt)).toContain('preserve the API');
      expect(JSON.stringify(options.prompt)).toContain('Current task');
      expect(JSON.stringify(options.prompt)).not.toContain(oldText);
    }
    expect(JSON.stringify(harness.getHistory())).toContain(oldText);
  });

  it('does not invoke the model or lose history if summarization fails', async () => {
    summarize.mockReset().mockResolvedValue(null);
    const model = new FauxModelProvider([fauxText('must not run')]);
    const harness = harnessFor(model);
    const consume = async () => {
      for await (const _event of harness.turn({ prompt: 'Current task', history: initialHistory, toolsOverride: [] })) { /* drain */ }
    };
    expectConsoleErrorMatching(args => args.some(arg => arg instanceof Error && arg.message.includes('Context compaction failed')), 'context compaction failure');
    await expect(consume()).rejects.toThrow('Context compaction failed');
    expect(model.remaining).toBe(1);
    expect(JSON.stringify(harness.getHistory())).toContain(oldText);
  });
});
