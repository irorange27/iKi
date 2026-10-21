// @vitest-environment node

/**
 * HARNESS OVERHEAD, isolated from the model.
 *
 * The end-to-end number a user feels is dominated by things iKi does not own:
 * the provider's time-to-first-token, the tool handler's own runtime, and (when
 * a turn pauses) however long the human takes to answer an approval card. A
 * profile that reports one number cannot tell you whether to optimise the
 * harness or the prompt.
 *
 * So this measures the part iKi DOES own: everything between "a scripted model
 * replied instantly" and "the turn settled" — projection, hook plumbing, step
 * recording, finalize. The scripted provider resolves immediately, so any
 * duration here is ours.
 */
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { createTool, defaultToolRegistry, registerStandardTools } from '@iki/backend/tools';
import { createAgentRunTracker } from '@iki/backend/thread_session/run_tracker';
import { startPiTurnHarness } from '@iki/backend/agent/harness';
import { getToolModel } from '@iki/backend/provider/tool_model';
import { createScriptedPiChat } from '@iki/backend/agent/testing/scripted_pi';

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
    finalize: {
      finalizeSuccess: vi.fn(),
      finalizeFailure: vi.fn(),
    },
  } as never,
});

const TOOL = 'overhead_probe';

const buildHarness = (maxIterations: number) =>
  startPiTurnHarness({
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
    maxIterations,
  } as never);

const runOnce = async (maxIterations: number, steps: number): Promise<number> => {
  // The budget bounds MODEL CALLS, so the script needs one entry per call: the
  // tool steps above it. An undersized script is the benchmark's own bug and
  // the scripted provider says so loudly rather than replaying an earlier reply.
  callPiChatMock.mockImplementation(
    createScriptedPiChat(
      Array.from({ length: maxIterations }, (_, index) => [
        { kind: 'toolCall', toolName: TOOL, args: {}, id: `call_${index}` },
        { kind: 'done', reason: 'toolUse' },
      ])
    )
  );
  const harness = buildHarness(maxIterations);
  const started = performance.now();
  for await (const _event of harness.turn({ prompt: 'go' })) {
    void _event;
  }
  return performance.now() - started;
};

describe('harness overhead with an instant model', () => {
  it('reports per-step cost without the provider in the loop', async () => {
    defaultToolRegistry.register(
      createTool({
        name: TOOL,
        type: 'function',
        description: 'overhead probe',
        paramSchema: z.object({}),
        needsApproval: false,
        handler: async () => 'observation',
      })
    );
    try {
      // Warm up: the first turn pays module init and registry resolution.
      await runOnce(2, 1);

      const samples: number[] = [];
      for (let i = 0; i < 12; i += 1) samples.push(await runOnce(2, 1));

      const sorted = [...samples].sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)]!;
      const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]!;

      // eslint-disable-next-line no-console
      console.log(
        `HARNESS_OVERHEAD one tool step: median=${median.toFixed(1)}ms p95=${p95.toFixed(1)}ms min=${sorted[0]!.toFixed(1)}ms max=${sorted[sorted.length - 1]!.toFixed(1)}ms n=${sorted.length}`
      );

      // A single scripted step must not cost tens of milliseconds of our own
      // work; if it does, something on this path got expensive (a per-step
      // re-read, a rebuild, an accidental await on I/O).
      expect(median).toBeLessThan(50);
    } finally {
      defaultToolRegistry.remove(TOOL);
    }
  });
});
