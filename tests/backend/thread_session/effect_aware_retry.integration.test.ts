// @vitest-environment node

/**
 * Issue #143 (the #141 fork decision (b)): a retry CONTINUES from the dead
 * chain's journaled tool effects. The recovery history carries the executed
 * exchange pairs (APPROVAL_REQUESTED × TOOL_EXECUTION_FINISHED join by
 * approvalId) after the task input, the tail guard accepts the tool tail,
 * and the streaming path's empty-prompt guard stands down for the
 * continuation shape — the model sees what already happened instead of
 * re-issuing it.
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const createModelMock = vi.hoisted(() => vi.fn());
const userDataMock = vi.hoisted(() => vi.fn(() => ''));

vi.mock('@iki/backend/platform', async importOriginal => ({
  ...(await importOriginal<typeof import('@iki/backend/platform')>()),
  getUserDataPath: userDataMock,
}));
vi.mock('@iki/backend/provider/llm/factory', async importOriginal => ({
  ...(await importOriginal<typeof import('@iki/backend/provider/llm/factory')>()),
  createModel: createModelMock,
  disposeLanguageModel: vi.fn(),
  resolvePersonaPrompt: () => 'persona prompt',
  getModelGenerationSettings: () => ({}),
  resolveModelCapability: async () => ({
    contextWindow: 100000,
    maxInputTokens: 98000,
    maxOutputTokens: 2000,
  }),
  // These suites verify DURABLE behaviour (effect-aware retry, cancel routing,
  // handoff facts, inline journaling) using a scripted AI SDK model. They are
  // not about supply routing, so they pin the AI SDK harness explicitly: Pi
  // claims every provider type now, and a stubbed `createModel` would never be
  // reached. Routing itself is covered by factory_pi_generation.test.ts and
  // turn_supply_selection.test.ts.
  supportsPiTurnSupply: () => false,
}));

import { closeDatabase, initializeDatabase } from '@iki/backend/db/database';
import { addProvider } from '@iki/backend/db/providers';
import * as agentRunDb from '@iki/backend/db/agent_runs';
import { addWorkspace } from '@iki/backend/db/workspaces';
import { createChatService } from '@iki/backend/thread_session/service';
import { piTurnHarness, setTurnHarnessFallback } from '@iki/backend/thread_session/turn_supply_selection';
import {
  APPROVAL_DECIDED,
  APPROVAL_REQUESTED,
  INPUT_ACCEPTED,
  MODEL_TEXT_COMMITTED,
  rebuildThreadViewFromEvents,
  recordSessionEvents,
  SESSION_EVENT_VERSION,
} from '@iki/backend/thread_session/session_log';
import { TOOL_EXECUTION_FINISHED } from '@iki/backend/thread_session/tool_execution';
import { FauxModelProvider, fauxText } from '@iki/backend/agent/testing/faux_model';

const TASK_TEXT = 'E2E_EFFECT_143 write the report';
const EXECUTED_OUTPUT = 'file written by the dead attempt';

const seedRun = (runId: string, status: 'failed' | 'completed') => {
  agentRunDb.createAgentRun({
    id: runId,
    kind: 'chat-turn',
    status,
    threadId: 'thread_effect143',
    rootRunId: runId,
    providerType: 'openai',
    model: 'resume-model',
    systemPrompt: 'resume system',
    enabledTools: [],
    availableSkillIds: [],
    input: { prompt: '', messages: [], metadata: {} },
    working: {
      modelMessages: [],
      accumulatedText: '',
      pendingApprovalIds: [],
      lastStepIndex: 0,
    },
    output: null,
    error: null,
  } as never);
};

const recordInputFact = () => {
  recordSessionEvents('thread_effect143', [
    {
      type: INPUT_ACCEPTED,
      version: SESSION_EVENT_VERSION,
      payload: {
        messageId: 'input_effect143',
        message: {
          id: 'input_effect143',
          role: 'user',
          parts: [{ type: 'text', text: TASK_TEXT }],
        } as never,
      },
    },
  ]);
};

const recordExecutedCall = (overrides?: {
  approvalId?: string;
  args?: unknown;
  output?: unknown;
  approved?: boolean;
  executed?: boolean;
}) => {
  const approvalId = overrides?.approvalId ?? 'ap_effect143';
  const executed = overrides?.executed ?? true;
  const output = overrides?.output ?? { type: 'text', value: EXECUTED_OUTPUT };
  recordSessionEvents('thread_effect143', [
    {
      type: APPROVAL_REQUESTED,
      version: SESSION_EVENT_VERSION,
      payload: {
        approvalId,
        runId: 'run_effect143_a',
        toolCallId: 'call_effect143',
        toolName: 'write_file',
        args: overrides?.args ?? { path: 'report.txt', content: 'v1' },
      },
    },
    {
      type: APPROVAL_DECIDED,
      version: SESSION_EVENT_VERSION,
      payload: { approvalId, approved: overrides?.approved ?? true, source: 'user' },
    },
    ...(executed
      ? [
          {
            type: TOOL_EXECUTION_FINISHED,
            version: SESSION_EVENT_VERSION,
            payload: {
              binding: {
                threadId: 'thread_effect143',
                approvalId,
                messageId: 'assistant_dead',
                toolCallId: 'call_effect143',
                toolName: 'write_file',
                args: overrides?.args ?? { path: 'report.txt', content: 'v1' },
                workspace: null,
              },
              decision: (overrides?.approved ?? true) ? 'approved' : 'rejected',
              result: {
                type: 'tool-result',
                toolCallId: 'call_effect143',
                toolName: 'write_file',
                output,
              },
              source: 'execution',
            },
          },
        ]
      : []),
  ]);
};

describe('effect-aware retry continues from the dead chain journaled effects', () => {
  let root: string;
  let service: ReturnType<typeof createChatService>;
  const target = { id: 3, send: vi.fn() };

  beforeEach(async () => {
  // These suites drive the DURABLE layer (streaming, approvals, session-log
  // facts, retry, persistence) with a scripted AI SDK model. They are not about
  // which supply serves the turn, so they opt into the legacy executor: the
  // production default refuses a turn its projection cannot carry, and a
  // scripted model has no endpoint to project to.
  setTurnHarnessFallback(piTurnHarness);
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'iki-effect-retry-'));
    userDataMock.mockReturnValue(root);
    initializeDatabase({ dbPath: path.join(root, 'effect.db') });
    addProvider({
      id: 'provider_primary',
      name: 'primary',
      type: 'openai',
      api_key: 'key-effect143',
      models: '["resume-model"]',
      base_url: 'http://127.0.0.1:9/v1',
      enabled: true,
    });
    addWorkspace({ id: 'ws_effect143', path: root, name: 'effect143' });
    const conversation = (service = createChatService()) as unknown as {
      createThread: (input: Record<string, unknown>) => unknown;
    };
    conversation.createThread({ id: 'thread_effect143', workspace_id: 'ws_effect143' });
  });

  afterEach(async () => {
    closeDatabase();
    await fs.rm(root, { recursive: true, force: true });
  });

  it('a retry puts the journaled exchange pair on the wire and completes as a continuation', async () => {
    seedRun('run_effect143_a', 'failed');
    recordInputFact();
    recordExecutedCall();
    // The dead attempt's committed text — chain-excluded, never on the wire.
    recordSessionEvents('thread_effect143', [
      {
        type: MODEL_TEXT_COMMITTED,
        version: SESSION_EVENT_VERSION,
        payload: { runId: 'run_effect143_a', messageId: 'assistant_dead', seq: 0, text: 'DEAD_TEXT_143' },
      },
    ]);
    const model = new FauxModelProvider([fauxText('continued from the executed call')]);
    const providerCalls = vi.spyOn(model, 'doStream');
    createModelMock.mockReturnValue(model);

    const result = await service.retryAndExecute(target, 'run_effect143_a');

    if (!result.success) throw new Error(`retry failed: ${JSON.stringify(result)}`);
    const wire = JSON.stringify(providerCalls.mock.calls[0][0]);
    // The task input AND the executed effect both ride; the dead text does not.
    expect(wire).toContain(TASK_TEXT);
    expect(wire).toContain('call_effect143');
    expect(wire).toContain(EXECUTED_OUTPUT);
    expect(wire).not.toContain('DEAD_TEXT_143');
    // The exchange pair is well-formed: assistant tool-call + tool result.
    expect(wire).toContain('report.txt');
    expect(result).toMatchObject({ success: true });
  });

  it('a denied execution pairs with its execution-denied result', async () => {
    // The FINISHED shape here is what the owner journals for a denial since
    // #143 (pinned end-to-end in pi_approval_owner.integration.test.ts);
    // this test pins the READER: the refusal rides the recovery history, so
    // the model does not re-ask a user who already said no.
    seedRun('run_effect143_a', 'failed');
    recordInputFact();
    recordExecutedCall({ approved: false, output: { type: 'text', value: 'execution denied by policy' } });
    const model = new FauxModelProvider([fauxText('acknowledged the denial')]);
    const providerCalls = vi.spyOn(model, 'doStream');
    createModelMock.mockReturnValue(model);

    const result = await service.retryAndExecute(target, 'run_effect143_a');

    if (!result.success) throw new Error(`retry failed: ${JSON.stringify(result)}`);
    const wire = JSON.stringify(providerCalls.mock.calls[0][0]);
    expect(wire).toContain('execution denied by policy');
  });

  it('a requested-but-never-executed approval produces no pair (the model re-issues)', async () => {
    seedRun('run_effect143_a', 'failed');
    recordInputFact();
    recordExecutedCall({ executed: false });
    const model = new FauxModelProvider([fauxText('re-ran the task')]);
    const providerCalls = vi.spyOn(model, 'doStream');
    createModelMock.mockReturnValue(model);

    const result = await service.retryAndExecute(target, 'run_effect143_a');

    if (!result.success) throw new Error(`retry failed: ${JSON.stringify(result)}`);
    const wire = JSON.stringify(providerCalls.mock.calls[0][0]);
    // Plain re-run shape: the task input ends the history, no fabricated pair.
    expect(wire).toContain(TASK_TEXT);
    expect(wire).not.toContain('call_effect143');
  });

  it('a journaled execution whose binding lost its args refuses the recovery loudly', async () => {
    seedRun('run_effect143_a', 'failed');
    recordInputFact();
    recordSessionEvents('thread_effect143', [
      {
        type: APPROVAL_REQUESTED,
        version: SESSION_EVENT_VERSION,
        payload: {
          approvalId: 'ap_effect143',
          runId: 'run_effect143_a',
          toolCallId: 'call_effect143',
          toolName: 'write_file',
        },
      },
      {
        type: TOOL_EXECUTION_FINISHED,
        version: SESSION_EVENT_VERSION,
        payload: {
          binding: {
            threadId: 'thread_effect143',
            approvalId: 'ap_effect143',
            messageId: 'assistant_dead',
            toolCallId: 'call_effect143',
            toolName: 'write_file',
            workspace: null,
          },
          decision: 'approved',
          result: {
            type: 'tool-result',
            toolCallId: 'call_effect143',
            toolName: 'write_file',
            output: { type: 'text', value: 'done' },
          },
          source: 'execution',
        },
      },
    ]);
    createModelMock.mockReturnValue(new FauxModelProvider([fauxText('must not run')]));

    const result = await service.retryAndExecute(target, 'run_effect143_a');

    expect(result).toMatchObject({ success: false });
    expect(result.error).toContain('cannot be represented from the log');
    expect(createModelMock).not.toHaveBeenCalled();
  });

  it('the replay still shows the whole story for display while the retry continues', async () => {
    seedRun('run_effect143_a', 'failed');
    recordInputFact();
    recordExecutedCall();
    const model = new FauxModelProvider([fauxText('continued')]);
    createModelMock.mockReturnValue(model);

    await service.retryAndExecute(target, 'run_effect143_a');

    const view = rebuildThreadViewFromEvents('thread_effect143');
    // Facts stay in the log: the journaled execution and the continuation
    // are both part of the thread's story.
    expect(
      view.events.filter(event => event.type === TOOL_EXECUTION_FINISHED)
    ).toHaveLength(1);
    expect(view.turns.filter(turn => turn.status === 'completed').length).toBeGreaterThanOrEqual(1);
  });
});
