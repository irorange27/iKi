import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const createModelMock = vi.hoisted(() => vi.fn());
const callPiChatMock = vi.hoisted(() => vi.fn());
const generationSettingsMock = vi.hoisted(() => vi.fn(() => ({})));

// The supply seam: Pi is the only executor (ADR 009). Scripting it here keeps
// these suites on the durable-layer behaviour they assert without reaching a
// network endpoint.
vi.mock('@iki/backend/provider/llm/pi_adapter', async importOriginal => ({
  ...(await importOriginal<typeof import('@iki/backend/provider/llm/pi_adapter')>()),
  callPiChat: callPiChatMock,
}));

vi.mock('@iki/backend/thread_session/turn_supply_selection', async importOriginal => ({
  ...(await importOriginal<typeof import('@iki/backend/thread_session/turn_supply_selection')>()),
  // The admission check calls `getProviderConfig` INTERNALLY inside the factory
  // module, so mocking that module cannot reach it. This suite has no database
  // and does not test admission.
  pausedPlanRunsOnPiToolSupply: () => true,
}));

vi.mock('@iki/backend/provider/llm/factory', async importOriginal => {
  const actual = await importOriginal<typeof import('@iki/backend/provider/llm/factory')>();
  return {
    ...actual,
    resolvePersonaPrompt: vi.fn(() => 'persona prompt'),
    getModelGenerationSettings: generationSettingsMock,
    getProviderConfig: () => ({
      type: 'openai',
      apiKey: 'key-test',
      baseURL: 'http://127.0.0.1:9/v1',
    }),
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
import { startPiTurnHarness } from '@iki/backend/agent/harness';
import { createScriptedPiChat } from '@iki/backend/agent/testing/scripted_pi';
import { createScriptedPiChat } from '@iki/backend/agent/testing/scripted_pi';
import { runWithToolRuntimeContext } from '@iki/backend/utils/runtime_context';
import { createTool, defaultToolRegistry } from '@iki/backend/tools';
import {
  MODEL_OUTPUT_COMMITTED,
  recordSessionEvents,
  SESSION_EVENT_VERSION,
} from '@iki/backend/thread_session/session_log';

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
    // The model asks for the gated tool; the harness pauses for approval.
    callPiChatMock.mockImplementation(
      createScriptedPiChat([
        [
          { kind: 'toolCall', toolName, args: {}, id: 'call_paused' },
          { kind: 'done', reason: 'toolUse' },
        ],
      ])
    );
    const harness = startPiTurnHarness({
      providerType: 'openai',
      model: 'test-model',
      systemPrompt: 'system prompt',
      enableTools: true,
      enabledToolNames: [toolName],
      availableSkillIds: [],
      guardActive: false,
      approvalPolicy: 'always',
      maxIterations: 10,
    });
    let approvalId = '';
    await runWithToolRuntimeContext(
      { threadId: 'thread_plan', runId: 'run_blocked_1' },
      async () => {
        for await (const event of harness.turn({ prompt: 'run the probe' })) {
          if (event.event === 'done') {
            const requests = event.output.toolApprovalRequests;
            if (!requests?.length) throw new Error('Probe did not receive an approval request');
            approvalId = requests[0].approvalId;
            // What the streaming path persists while approval-pending: the
            // partial assistant row carries the live approval-request part the
            // recovery fallback pairs the decision with.
            const partialAssistant = {
              id: 'assistant_plan',
              role: 'assistant' as const,
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
            };
            conversation.createMessage({
              id: 'assistant_plan',
              thread_id: 'thread_plan',
              message: partialAssistant,
            });
            // F2: the restart-recovery history source is the session log — the
            // pause records its partial output as a fact, exactly what the
            // streaming entry does in production.
            recordSessionEvents('thread_plan', [
              {
                type: MODEL_OUTPUT_COMMITTED,
                version: SESSION_EVENT_VERSION,
                payload: {
                  runId: 'run_blocked_1',
                  messageId: 'assistant_plan',
                  message: partialAssistant as never,
                  transport: 'stream',
                },
              },
            ]);
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
      }
    );
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
    callPiChatMock.mockImplementation(
      createScriptedPiChat([
        [
          { kind: 'toolCall', toolName: toolName, args: {}, id: 'call_r1' },
          { kind: 'done', reason: 'toolUse' },
        ],
        [
          { kind: 'text', text: 'must not be reached' },
          { kind: 'done', reason: 'stop' },
        ],
      ])
    );
    const doStream = callPiChatMock;
    generationSettingsMock.mockClear();

    expect(
      await recoveredApprovals.approveTool({ id: 92, send: vi.fn() }, approvalId, true)
    ).toMatchObject({ success: true });

    // One call to ask for the tool, one to answer after the decision.
    expect(doStream.mock.calls.length).toBeGreaterThanOrEqual(2);
    // The resumed plan is what the model must see: the Pi path carries the
    // restored autonomous budget as its own `continuePrompt` in the request
    // context, which is the plan fidelity this case is about (the AI SDK-only
    // `reasoningEffort` setting no longer rides this supply).
    const resumedContexts = doStream.mock.calls
      .slice(1)
      .map(call => JSON.stringify((call as unknown[])[1]));
    expect(resumedContexts.join('\n')).toContain('CONTINUE_FROM_PERSISTED_PLAN');
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
    callPiChatMock.mockImplementation(
      createScriptedPiChat([
        [
          { kind: 'toolCall', toolName, args: {}, id: 'call_paused_adopted' },
          { kind: 'done', reason: 'toolUse' },
        ],
        [
          { kind: 'text', text: 'approved and done' },
          { kind: 'done', reason: 'stop' },
        ],
      ])
    );
    const harness = startPiTurnHarness({
      providerType: 'openai',
      model: 'test-model',
      systemPrompt: 'system prompt',
      enableTools: true,
      enabledToolNames: [toolName],
      availableSkillIds: [],
      guardActive: false,
      approvalPolicy: 'always',
      maxIterations: 10,
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

    callPiChatMock.mockImplementation(
      createScriptedPiChat([
        [
          { kind: 'text', text: 'resumed into own identity' },
          { kind: 'done', reason: 'stop' },
        ],
      ])
    );
    expect(await approvals.approveTool({ id: 94, send: vi.fn() }, approvalId, true)).toMatchObject({
      success: true,
    });

    // The continuation owns a fresh run id — no claim of the adopted row.
    const resumedRuns = listAgentRunsByThread('thread_plan').filter(
      run => run.kind === 'approval-resume'
    );
    expect(resumedRuns).toHaveLength(1);
    expect(resumedRuns[0]!.id).not.toBe('run_adopted_queue');
  });
});
