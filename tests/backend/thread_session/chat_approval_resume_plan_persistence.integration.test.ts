import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const callPiChatMock = vi.hoisted(() => vi.fn());
const generationSettingsMock = vi.hoisted(() => vi.fn(() => ({})));

vi.mock('@iki/backend/provider/llm/pi_adapter', async importOriginal => ({
  ...(await importOriginal<typeof import('@iki/backend/provider/llm/pi_adapter')>()),
  callPiChat: callPiChatMock,
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
import { seedTurnProvider } from '../helpers/seed_turn_provider';
import { listAgentRunsByThread } from '@iki/backend/db/agent_runs';
import { createChatPersistence } from '@iki/backend/turn_prep/persistence';
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
  injectMemoryIntoMessages: vi.fn((messages: unknown[]) => messages),
  getAffectContextMessage: () => '',
};

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
    budget: { step: 1 },
    reasoningEffort: 'low',
    budget: { step: 1, batch: { max: 2, continuePrompt: 'CONTINUE_FROM_PERSISTED_PLAN' } },
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
    seedTurnProvider({ providerId: 'provider_primary', providerType: 'openai', model: 'test-model' });
    conversation = createChatPersistence({
      memory: memory as never,
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

    coordinator = createThreadStreamCoordinator();
    const recoveredApprovals = buildApprovals();

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

    expect(doStream.mock.calls.length).toBeGreaterThanOrEqual(2);
    const resumedContexts = doStream.mock.calls
      .slice(1)
      .map(call => JSON.stringify((call as unknown[])[1]));
    expect(resumedContexts.join('\n')).toContain('CONTINUE_FROM_PERSISTED_PLAN');
  });

  it('does not re-claim the parent’s adopted queued row when approving a paused retry', async () => {
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

    const resumedRuns = listAgentRunsByThread('thread_plan').filter(
      run => run.kind === 'approval-resume'
    );
    expect(resumedRuns).toHaveLength(1);
    expect(resumedRuns[0]!.id).not.toBe('run_adopted_queue');
  });
});
