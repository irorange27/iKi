// @vitest-environment node

/**
 * Single-authority regression for the approval decision (task: 审批决策归一).
 *
 * THE INVARIANT: under `askRisky`, a `write_file` call from a REAL turn must
 * STOP and wait for a human. The tool declares `needsApproval = true`
 * (tools/file_tools.ts) and askRisky's own contract is "known READS are free,
 * everything else escalates" (ADR 005 decision 1/2). Before this task the
 * resolver replaced that declaration with `classifyActionRisk`, whose
 * `WORKSPACE_WRITE_TOOLS` name list marked `write_file` safe under
 * trustWorkspace — and whose default argument was `trustWorkspace = true` —
 * so a write ran straight through under the DESKTOP DEFAULT policy. That is
 * the implicit privilege channel #166 forbids: the session dial silently
 * lowered a tool's own floor.
 *
 * This test deliberately does NOT stop at the resolver's pure function
 * (`decideToolApproval`). An assertion on the resolver alone cannot see the
 * consumer: the harness projects `needsApproval` onto the Pi loop tools and
 * the loop evaluates it before any effect. So we drive a real
 * `PiToolTurnHarness` through a scripted Pi model call with a real
 * `write_file` from the real registry, and assert the observable outcomes:
 *
 *   - the turn reports `requiresApproval` and emits `approval_request`,
 *   - the file on disk is NOT written,
 *   - the loop stops after the undecided call (exactly one model request).
 *
 * Against the pre-change code the write_file cases fail on the FIRST
 * observable (the call executes, the file lands, no approval request). The
 * `always` cases fail for the other half of the same defect: a policy that
 * never read `approvalMode` could lower a tool that declared the strongest
 * mode, and `never` cleared it outright.
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AssistantMessage, ToolCall } from '@earendil-works/pi-ai';
import { z } from 'zod';

const userDataMock = vi.hoisted(() => vi.fn(() => ''));
vi.mock('@iki/backend/platform', async importOriginal => ({
  ...(await importOriginal<typeof import('@iki/backend/platform')>()),
  getUserDataPath: userDataMock,
}));
vi.mock('@iki/backend/provider/llm/factory', async importOriginal => {
  const actual = await importOriginal<typeof import('@iki/backend/provider/llm/factory')>();
  return {
    ...actual,
    resolvePersonaPrompt: vi.fn(() => 'persona prompt'),
    getProviderConfig: vi.fn(() => ({
      id: 'provider_pi',
      type: 'custom-openai',
      apiKey: 'unit-key',
      baseURL: 'http://127.0.0.1:9/v1',
      models: ['pi-model'],
      modelOptions: {},
      isResponseApi: false,
    })),
  };
});

import { createTool, defaultToolRegistry, registerStandardTools } from '@iki/backend/tools';
import { createAgentRunTracker } from '@iki/backend/thread_session/run_tracker';
import { startPiTurnHarness } from '@iki/backend/agent/harness';
import { getToolModel } from '@iki/backend/provider/tool_model';
import {
  PiToolTurnHarness,
  type PiToolModelCall,
} from '@iki/backend/agent/runners/pi_tool_turn_harness';
import type { HarnessConfig, TurnEvent } from '@iki/backend/agent/harness/harness_types';

registerStandardTools({
  delegatedAgentRuntime: {
    createRunTracker: createAgentRunTracker,
    getConversationToolModel: getToolModel,
    createHarness: startPiTurnHarness,
  },
});

const assistantMessage = (content: AssistantMessage['content']): AssistantMessage => ({
  role: 'assistant',
  content,
  api: 'openai-completions',
  provider: 'iki-custom',
  model: 'pi-model',
  usage: {
    input: 10,
    output: 5,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 15,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  },
  stopReason: 'stop',
  timestamp: Date.now(),
});

const toolCall = (id: string, name: string, args: Record<string, unknown>): ToolCall => ({
  type: 'toolCall',
  id,
  name,
  arguments: args as ToolCall['arguments'],
});

/** One scripted Pi model call per loop request, in order. */
const scriptedModelCall = (steps: AssistantMessage['content'][]) => {
  let attempt = 0;
  const state = { requests: 0 };
  // The seam is a stream of Pi AssistantMessageEvents plus its settled
  // message — the same contract `callPiChat` returns, so the loop consumes it
  // exactly like a real provider stream.
  const call = ((_config: unknown) => {
    state.requests += 1;
    const content = steps[attempt];
    if (!content) throw new Error(`unexpected model call #${attempt + 1}`);
    attempt += 1;
    const final = assistantMessage(content);
    const started = assistantMessage([]);
    return {
      events: (async function* () {
        yield { type: 'start', partial: started };
        for (const [index, block] of content.entries()) {
          if (block.type === 'toolCall') {
            const partial = assistantMessage(content.slice(0, index + 1));
            yield { type: 'toolcall_end', contentIndex: index, toolCall: block, partial };
            continue;
          }
          if (block.type === 'text') {
            yield {
              type: 'text_delta',
              contentIndex: index,
              delta: block.text,
              partial: assistantMessage(content.slice(0, index + 1)),
            };
          }
        }
        yield { type: 'done', reason: 'stop', message: final };
      })(),
      final: Promise.resolve(final),
    };
  }) as unknown as PiToolModelCall;
  return { call, spent: () => state.requests };
};

const harnessConfig = (overrides: Partial<HarnessConfig> = {}): HarnessConfig => ({
  providerType: 'custom-openai',
  providerId: 'provider_pi',
  model: 'pi-model',
  systemPrompt: 'tool mode prompt',
  enableTools: true,
  enabledToolNames: ['write_file'],
  availableSkillIds: [],
  guardActive: false,
  requireApproval: false,
  autoApproveToolRequests: false,
  approvalPolicy: 'askRisky',
  maxIterations: 4,
  ...overrides,
});

const collect = async (harness: PiToolTurnHarness, prompt: string): Promise<TurnEvent[]> => {
  const events: TurnEvent[] = [];
  for await (const event of harness.turn({ prompt })) events.push(event);
  return events;
};

const stepsOf = (events: TurnEvent[]) =>
  events.filter(event => event.event === 'step').map(event => event.step);

const approvalSteps = (events: TurnEvent[]) =>
  stepsOf(events).filter(step => step.type === 'approval_request');

const doneOutput = (events: TurnEvent[]) => {
  const done = events.at(-1);
  if (done?.event !== 'done') throw new Error('turn did not end with an answer');
  return done.output;
};

describe('askRisky pauses a real write_file instead of executing it', () => {
  let root = '';
  let userData = '';

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'iki-approval-ws-'));
    userData = await fs.mkdtemp(path.join(os.tmpdir(), 'iki-approval-ud-'));
    userDataMock.mockReturnValue(userData);
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(userData, { recursive: true, force: true });
  });

  it('askRisky: write_file emits an approval request, writes nothing, and stops the loop', async () => {
    const target = path.join(root, 'ask_risky.txt');
    const scripted = scriptedModelCall([
      [toolCall('call_ask', 'write_file', { path: target, content: 'should not land' })],
      [{ type: 'text', text: 'never' }],
    ]);
    const harness = new PiToolTurnHarness(harnessConfig({ approvalPolicy: 'askRisky' }), {
      modelCall: scripted.call,
    });

    const events = await collect(harness, 'write the file');

    // Observable 1: the turn paused for a human.
    const paused = approvalSteps(events) as Array<{
      requests: Array<{ toolCall?: { toolName?: string }; toolCallId?: string }>;
    }>;
    expect(paused).toHaveLength(1);
    expect(paused[0].requests).toHaveLength(1);
    expect(paused[0].requests[0]).toMatchObject({
      toolCallId: 'call_ask',
      toolCall: { toolName: 'write_file' },
    });

    // Observable 2: no effect happened behind the card.
    expect(stepsOf(events).filter(step => step.type === 'tool_execution_start')).toHaveLength(0);
    await expect(fs.readFile(target, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });

    // Observable 3: the terminal answer carries the pending decisions.
    const output = doneOutput(events);
    expect(output.requiresApproval).toBe(true);
    expect(output.toolApprovalRequests).toEqual(paused[0].requests);
    // The loop stopped after the undecided call: one model request only.
    expect(scripted.spent()).toBe(1);
  });

  it('trustWorkspace: a workspace write runs (the dial is the user saying so)', async () => {
    // ADR 005 decision 1: `trustWorkspace` "让已知工作区读写放行"; decision 2:
    // it "还放行工作区写工具". The composer's own copy is "仅对判定为高风险的操作
    // 询问". Requiring approval for every write here made that copy a lie — the
    // earlier version of this case asserted the over-tight reading.
    //
    // The FLOOR that survives is `approvalMode: 'always'` (next case): the
    // author states the EFFECT, the dial only states the user's TOLERANCE, and
    // tolerance cannot shrink an effect. `write_file`'s own `needsApproval:
    // true` is its DEFAULT (what applies with no dial), not a floor.
    const target = path.join(root, 'trust.txt');
    const scripted = scriptedModelCall([
      [toolCall('call_trust', 'write_file', { path: target, content: 'lands' })],
      [{ type: 'text', text: 'done' }],
    ]);
    const harness = new PiToolTurnHarness(harnessConfig({ approvalPolicy: 'trustWorkspace' }), {
      modelCall: scripted.call,
    });

    const events = await collect(harness, 'write the file');

    // The dial means "run it": no card, and the call REACHES execution.
    //
    // This asserts the DECISION, not the write. A filesystem assertion here
    // would need a registered workspace (the path boundary refuses writes
    // outside one — correctly), and the decision is already pinned at the pure
    // authority in `tests/backend/utils/action_risk.test.ts`. Duplicating the
    // workspace bootstrap would test the sandbox, not the approval rule.
    expect(approvalSteps(events)).toHaveLength(0);
    expect(stepsOf(events).filter(step => step.type === 'tool_execution_start')).toHaveLength(1);
    expect(doneOutput(events).requiresApproval).toBeFalsy();
  });

  it('always: a read-only tool asks too (the strictest dial is never weakened)', async () => {
    // `read_file` declares needsApproval = false and sits in the askRisky name
    // list. Under `always` it must still be gated, so the strictest setting is
    // never silently bypassed by a whitelist.
    const harness = new PiToolTurnHarness(
      harnessConfig({ approvalPolicy: 'always', enabledToolNames: ['read_file'] }),
      {
        modelCall: scriptedModelCall([
          [toolCall('call_read', 'read_file', { path: path.join(root, 'anything.txt') })],
          [{ type: 'text', text: 'never' }],
        ]).call,
      }
    );

    const events = await collect(harness, 'read it');

    expect(approvalSteps(events)).toHaveLength(1);
    expect(doneOutput(events).requiresApproval).toBe(true);
  });
});

describe('approvalMode: always is a floor no dial can lower', () => {
  const probeName = 'zz_always_probe';

  afterEach(() => {
    defaultToolRegistry.remove(probeName);
  });

  const runProbe = async (policy: HarnessConfig['approvalPolicy']) => {
    // An approval-free tool that still claims the strongest mode. Before the
    // single authority, `never` cleared it outright and askRisky /
    // trustWorkspace answered from a NAME list that does not contain the
    // probe — so `always` only "worked" by accident.
    defaultToolRegistry.register(
      createTool({
        name: probeName,
        type: 'function',
        description: 'always-approval probe',
        paramSchema: z.object({ path: z.string() }),
        needsApproval: false,
        approvalMode: 'always',
        handler: async (args: { path: string }) => `probe read ${args.path}`,
      })
    );
    const harness = new PiToolTurnHarness(
      harnessConfig({ approvalPolicy: policy, enabledToolNames: [probeName] }),
      {
        modelCall: scriptedModelCall([
          [toolCall('call_probe', probeName, { path: 'a.txt' })],
          [{ type: 'text', text: 'never' }],
        ]).call,
      }
    );
    return collect(harness, 'probe');
  };

  it.each(['askRisky', 'trustWorkspace'] as const)(
    '%s: an approval-free tool marked always still asks',
    async policy => {
      const events = await runProbe(policy);
      expect(approvalSteps(events)).toHaveLength(1);
      expect(doneOutput(events).requiresApproval).toBe(true);
    }
  );

  it('never: the tool floor still wins (ADR 005 exception is the DIAL, not the tool) -- documented in IMPL-approval.md', async () => {
    // ADR 005 decision 1 makes `never` a legitimate headless dial: "all tools
    // resolved through ordinary approval need no approval". The single
    // authority keeps that exception for the DIAL, but it can no longer be
    // reached by an `always` tool being downgraded through *policy arithmetic*
    // — the exception is one explicit branch in decideToolApproval, not the
    // absence of a check. This case pins the documented headless behavior so
    // changing it is a deliberate ADR edit, not a silent side effect.
    const events = await runProbe('never');
    expect(approvalSteps(events)).toHaveLength(0);
    expect(doneOutput(events).requiresApproval).toBe(false);
  });
});
