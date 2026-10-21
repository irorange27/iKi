// @vitest-environment node

/**
 * Does the per-step cost stay flat as the history grows?
 *
 * The end-to-end profile of real turns (56 runs in the app database) shows the
 * wall time is model-bound, but that verdict only holds if OUR work per step
 * does not scale with the transcript. This measures one step against histories
 * of very different sizes: a per-step rebuild that walked the whole transcript
 * would show up here as a linear slope, and would eventually dominate.
 */
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { createTool, defaultToolRegistry, registerStandardTools } from '@iki/backend/tools';
import { createAgentRunTracker } from '@iki/backend/thread_session/run_tracker';
import { startPiTurnHarness } from '@iki/backend/agent/harness';
import { getToolModel } from '@iki/backend/provider/tool_model';
import { createScriptedPiChat } from '@iki/backend/agent/testing/scripted_pi';
import type { ModelMessage } from '@iki/backend/message/model_history';

const callPiChatMock = vi.hoisted(() => vi.fn());
vi.mock('@iki/backend/provider/llm/pi_adapter', async importOriginal => ({
  ...(await importOriginal<typeof import('@iki/backend/provider/llm/pi_adapter')>()),
  callPiChat: callPiChatMock,
}));
vi.mock('@iki/backend/provider/llm/factory', async importOriginal => {
  const actual = await importOriginal<typeof import('@iki/backend/provider/llm/factory')>();
  return {
    ...actual,
    resolvePersonaPrompt: vi.fn(() => 'persona'),
    getModelGenerationSettings: vi.fn(() => ({})),
    getProviderConfig: vi.fn(() => ({
      type: 'openai',
      apiKey: 'k',
      baseURL: 'http://127.0.0.1:9/v1',
    })),
  };
});

registerStandardTools({
  delegatedAgentRuntime: {
    createRunTracker: createAgentRunTracker,
    getConversationToolModel: getToolModel,
    createHarness: startPiTurnHarness,
    finalize: { finalizeSuccess: vi.fn(), finalizeFailure: vi.fn() },
  } as never,
});

const TOOL = 'projection_probe';

const historyOf = (pairs: number): ModelMessage[] => {
  const out: ModelMessage[] = [];
  for (let i = 0; i < pairs; i += 1) {
    out.push({ role: 'user', content: `question ${i} ${'context '.repeat(30)}` });
    out.push({ role: 'assistant', content: `answer ${i} ${'detail '.repeat(30)}` });
  }
  return out;
};

const timedStep = Object.assign(
  async (pairs: number): Promise<number> => {
  // Two entries: a turn with `maxIterations: 1` still made a second model call
  // here (counted, not assumed). The extra entry keeps the benchmark measuring
  // projection cost instead of dying on an undersized script.
  callPiChatMock.mockImplementation(
    createScriptedPiChat([
      [{ kind: 'text', text: 'done' }, { kind: 'done', reason: 'stop' }],
      [{ kind: 'text', text: 'done' }, { kind: 'done', reason: 'stop' }],
    ])
  );
  const harness = startPiTurnHarness({
    providerType: 'openai',
    model: 'probe-model',
    systemPrompt: 'You are a probe.',
    enableTools: true,
    enabledToolNames: [TOOL],
    availableSkillIds: [],
    guardActive: false,
    requireApproval: false,
    autoApproveToolRequests: true,
    approvalPolicy: 'never',
    maxIterations: 1,
    maxInputTokens: 10_000_000,
  } as never);
  const history = historyOf(pairs);
  const callsBefore = callPiChatMock.mock.calls.length;
  const started = performance.now();
  for await (const _event of harness.turn({ prompt: 'final', history })) {
    void _event;
  }
  const elapsed = performance.now() - started;
  timedStep.lastCalls = callPiChatMock.mock.calls.length - callsBefore;
  return elapsed;
  },
  { lastCalls: 0 }
);

describe('per-step cost vs transcript size', () => {
  it('stays proportional to the request, not to a per-step rebuild of everything', async () => {
    defaultToolRegistry.register(
      createTool({
        name: TOOL,
        type: 'function',
        description: 'projection probe',
        paramSchema: z.object({}),
        needsApproval: false,
        handler: async () => 'ok',
      })
    );
    try {
      // SEQUENTIAL, not Promise.all: `callPiChatMock` is ONE shared mock, so
      // concurrent runs would overwrite each other's script and the reported
      // time would belong to whichever run lost the race.
      const best = async (pairs: number): Promise<number> => {
        let min = Number.POSITIVE_INFINITY;
        for (let i = 0; i < 3; i += 1) min = Math.min(min, await timedStep(pairs));
        return min;
      };

      await timedStep(1); // warm up
      const small = await best(5);
      const large = await best(400);

      // eslint-disable-next-line no-console
      console.log(
        `HARNESS_PROJECTION 10 msgs=${small.toFixed(2)}ms 800 msgs=${large.toFixed(2)}ms ratio=${(large / Math.max(small, 0.01)).toFixed(1)}x modelCallsPerStep=${timedStep.lastCalls}`
      );

      // 80x the transcript must not cost 80x the per-step time: the projection
      // is O(request size), but there is no per-step rebuild over history.
      expect(large).toBeLessThan(Math.max(60, small * 80));
    } finally {
      defaultToolRegistry.remove(TOOL);
    }
  });
});
