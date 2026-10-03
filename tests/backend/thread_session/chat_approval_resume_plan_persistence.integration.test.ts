import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const createModelMock = vi.hoisted(() => vi.fn());
const generationSettingsMock = vi.hoisted(() => vi.fn(() => ({})));

vi.mock('@iki/backend/provider/llm/factory', async importOriginal => {
  const actual = await importOriginal<typeof import('@iki/backend/provider/llm/factory')>();
  return {
    ...actual,
    createModel: createModelMock,
    disposeLanguageModel: vi.fn(),
    getFullSystemPrompt: vi.fn(() => 'persona prompt'),
    getModelGenerationSettings: generationSettingsMock,
  };
});

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { closeDatabase, initializeDatabase } from '@iki/backend/db/database';
import { listAgentRunsByThread } from '@iki/backend/db/agent_runs';
import { createChatPersistence } from '@iki/backend/turn_prep/persistence';
import { onMessagePersisted } from '@iki/backend/thread_session/platform';
import { createChatApproval } from '@iki/backend/thread_session/approval';
import { createThreadStreamCoordinator } from '@iki/backend/thread_session/thread_stream_coordinator';
import type { ExecutionPlan } from '@iki/backend/thread_session/execution_plan';
import { AgentHarness } from '@iki/backend/agent/harness';
import { FauxModelProvider, fauxText, fauxToolCall } from '@iki/backend/agent/testing/faux_model';
import { runWithToolRuntimeContext } from '@iki/backend/utils/runtime_context';
import { createTool, defaultToolRegistry } from '@iki/backend/tools';

const toolName = 'plan_persistence_probe';

const memory = {
  onMessagePersisted: vi.fn(),
  injectMemoryIntoMessages: vi.fn((messages: unknown[]) => messages),
  getAffectContextMessage: () => '',
};

// Stage B acceptance: the plan is the versioned authority a resume reads.
// The approval session row persists the full ExecutionPlan snapshot, so a
// restart-recovered resume restores every field — including ones the legacy
// per-column projection never stored (reasoning effort, autonomy) — instead
// of re-deriving a lossy subset.
describe('approval resume restores the persisted plan after a restart', () => {
  let root: string;
  let conversation: ReturnType<typeof createChatPersistence>;
  let coordinator: ReturnType<typeof createThreadStreamCoordinator>;

  const buildApprovals = () =>
    createChatApproval({
      streams: {
        tryAcquireThreadRun: coordinator.tryAcquireThreadRun,
        peek: coordinator.peekStream,
        attach: coordinator.attachStream,
        detach: coordinator.detachStream,
      },
      memory: memory as never,
      conversation: conversation as never,
      usage: { recordUsageEvent: vi.fn() },
    });
  const pausedPlan: ExecutionPlan = {
    providerType: 'openai',
    model: 'test-model',
    enableTools: true,
    enabledTools: [toolName],
    availableSkillIds: [],
    guardActive: false,
    requireApproval: false,
    autoApproveToolRequests: false,
    maxIterations: 1,
    reasoningEffort: 'low',
    autonomous: { maxIterations: 2, continuePrompt: 'CONTINUE_FROM_PERSISTED_PLAN' },
    systemPrompt: 'system prompt',
    skillMode: 'manual',
    kind: 'chat-turn',
    runMetadata: {},
    transport: 'stream',
    threadId: 'thread_plan',
  };

  const pauseOnApproval = async (approvals: ReturnType<typeof createChatApproval>) => {
    defaultToolRegistry.register(
      createTool({
        name: toolName,
        type: 'function',
        description: 'Probe plan persistence',
        paramSchema: z.object({}),
        needsApproval: false,
        handler: async () => 'observed',
      })
    );
    const harness = new AgentHarness({
      providerType: 'openai',
      model: 'test-model',
      systemPrompt: 'system prompt',
      enableTools: true,
      enabledToolNames: [toolName],
      availableSkillIds: [],
      guardActive: false,
      approvalPolicy: 'always',
      maxIterations: 10,
      modelFactory: () =>
        new FauxModelProvider([fauxToolCall(toolName, {}, { id: 'call_paused' })]),
    });
    let approvalId = '';
    await runWithToolRuntimeContext({ threadId: 'thread_plan', runId: 'run_blocked_1' }, async () => {
      for await (const event of harness.turn({ prompt: 'run the probe' })) {
        if (event.event === 'done') {
          const requests = event.output.toolApprovalRequests;
          if (!requests?.length) throw new Error('Probe did not receive an approval request');
          approvalId = requests[0].approvalId;
          // What the streaming path persists while approval-pending: the
          // partial assistant row carries the live approval-request part the
          // recovery fallback pairs the decision with.
          conversation.createMessage({
            id: 'assistant_plan',
            thread_id: 'thread_plan',
            message: {
              id: 'assistant_plan',
              role: 'assistant',
              parts: [
                {
                  type: 'dynamic-tool',
                  toolCallId: 'call_paused',
                  toolName,
                  state: 'approval-requested',
                  input: {},
                  approval: { id: approvalId },
                },
              ],
            },
          });
          approvals.registerApprovalBatch(requests, {
            target: { id: 91, send: vi.fn() },
            history: harness.getHistory(),
            recoveryContext: {
              plan: pausedPlan,
              sessionId: 'assistant_plan',
              assistantMessageId: 'assistant_plan',
              runId: 'run_blocked_1',
            },
          });
        }
      }
    });
    return { approvalId };
  };

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'iki-approval-plan-'));
    initializeDatabase({ dbPath: path.join(root, 'plan.db') });
    conversation = createChatPersistence({
      memory: memory as never,
      onContinuityMessagePersisted: onMessagePersisted,
    });
    conversation.createThread({ id: 'thread_plan' });
    coordinator = createThreadStreamCoordinator();
  });

  afterEach(async () => {
    defaultToolRegistry.remove(toolName);
    closeDatabase();
    await fs.rm(root, { recursive: true, force: true });
  });

  it('keeps reasoning effort and autonomous batching across the restart', async () => {
    const { approvalId } = await pauseOnApproval(buildApprovals());

    // Simulate the restart: a fresh approvals registry with no in-memory
    // state — recovery must come from the persisted row.
    coordinator = createThreadStreamCoordinator();
    const recoveredApprovals = buildApprovals();

    // One tool call per SDK step (maxIterations 1): the restored autonomy
    // (2 batches) drives exactly 2 provider calls; the legacy derivation
    // would run 1 and stop.
    const model = new FauxModelProvider([
      fauxToolCall(toolName, {}, { id: 'call_r1' }),
      fauxText('must not be reached'),
    ]);
    const doStream = vi.spyOn(model, 'doStream');
    createModelMock.mockReturnValue(model);
    generationSettingsMock.mockClear();

    expect(
      await recoveredApprovals.approveTool({ id: 92, send: vi.fn() }, approvalId, true)
    ).toMatchObject({ success: true });

    expect(doStream).toHaveBeenCalledTimes(2);
    const resumedSettings = generationSettingsMock.mock.calls.filter(
      call => (call[0] as { reasoningEffort?: string })?.reasoningEffort === 'low'
    );
    expect(resumedSettings.length).toBeGreaterThan(0);
  });

  it('does not re-claim the parent’s adopted queued row when approving a paused retry', async () => {
    // A queued-resume/retry turn executes inside its adopted run id
    // (plan.adoptRunId). When that turn pauses on an approval, the approval
    // resume must run under its own NEW identity: re-claiming the adopted
    // row would fail the conditional claim (the row is `blocked`, not
    // `queued`), throw after the decision was already consumed, and strand
    // the run blocked forever.
    defaultToolRegistry.register(
      createTool({
        name: toolName,
        type: 'function',
        description: 'Probe adopted-turn resume',
        paramSchema: z.object({}),
        needsApproval: false,
        handler: async () => 'observed',
      })
    );
    const approvals = buildApprovals();
    const harness = new AgentHarness({
      providerType: 'openai',
      model: 'test-model',
      systemPrompt: 'system prompt',
      enableTools: true,
      enabledToolNames: [toolName],
      availableSkillIds: [],
      guardActive: false,
      approvalPolicy: 'always',
      maxIterations: 10,
      modelFactory: () =>
        new FauxModelProvider([fauxToolCall(toolName, {}, { id: 'call_paused_adopted' })]),
    });
    let approvalId = '';
    await runWithToolRuntimeContext(
      { threadId: 'thread_plan', runId: 'run_adopted_queue' },
      async () => {
        for await (const event of harness.turn({ prompt: 'run the probe' })) {
          if (event.event === 'done') {
            const requests = event.output.toolApprovalRequests;
            if (!requests?.length) throw new Error('Probe did not receive an approval request');
            approvalId = requests[0].approvalId;
            conversation.createMessage({
              id: 'assistant_adopted',
              thread_id: 'thread_plan',
              message: {
                id: 'assistant_adopted',
                role: 'assistant',
                parts: [
                  {
                    type: 'dynamic-tool',
                    toolCallId: 'call_paused_adopted',
                    toolName,
                    state: 'approval-requested',
                    input: {},
                    approval: { id: approvalId },
                  },
                ],
              },
            });
            approvals.registerApprovalBatch(requests, {
              target: { id: 93, send: vi.fn() },
              history: harness.getHistory(),
              recoveryContext: {
                plan: { ...pausedPlan, adoptRunId: 'run_adopted_queue' },
                sessionId: 'assistant_adopted',
                assistantMessageId: 'assistant_adopted',
                runId: 'run_adopted_queue',
              },
            });
          }
        }
      }
    );

    createModelMock.mockReturnValue(
      new FauxModelProvider([fauxText('resumed into own identity')])
    );
    expect(
      await approvals.approveTool({ id: 94, send: vi.fn() }, approvalId, true)
    ).toMatchObject({ success: true });

    // The continuation owns a fresh run id — no claim of the adopted row.
    const resumedRuns = listAgentRunsByThread('thread_plan').filter(
      run => run.kind === 'approval-resume'
    );
    expect(resumedRuns).toHaveLength(1);
    expect(resumedRuns[0]!.id).not.toBe('run_adopted_queue');
  });
});
