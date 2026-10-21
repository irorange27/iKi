// @vitest-environment node

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const callPiChatMock = vi.hoisted(() => vi.fn());
const userDataMock = vi.hoisted(() => vi.fn(() => ''));

vi.mock('@iki/backend/provider/llm/pi_adapter', async importOriginal => ({
  ...(await importOriginal<typeof import('@iki/backend/provider/llm/pi_adapter')>()),
  callPiChat: callPiChatMock,
}));

vi.mock('@iki/backend/platform', async importOriginal => ({
  ...(await importOriginal<typeof import('@iki/backend/platform')>()),
  getUserDataPath: userDataMock,
}));
vi.mock('@iki/backend/provider/llm/factory', async importOriginal => ({
  ...(await importOriginal<typeof import('@iki/backend/provider/llm/factory')>()),
  resolvePersonaPrompt: () => 'persona prompt',
  getModelGenerationSettings: () => ({}),
  resolveModelCapability: async () => ({
    contextWindow: 100000,
    maxInputTokens: 98000,
    maxOutputTokens: 2000,
  }),
  supportsPiTurnSupply: () => false,
}));

import { closeDatabase, initializeDatabase } from '@iki/backend/db/database';
import { addProvider } from '@iki/backend/db/providers';
import * as agentRunDb from '@iki/backend/db/agent_runs';
import { addWorkspace } from '@iki/backend/db/workspaces';
import { createChatService } from '@iki/backend/thread_session/service';
import {
  piTurnHarness,
  setTurnHarnessFallback,
} from '@iki/backend/thread_session/turn_supply_selection';
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
import { createScriptedPiChat } from '@iki/backend/agent/testing/scripted_pi';

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
    vi.clearAllMocks();
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
    recordSessionEvents('thread_effect143', [
      {
        type: MODEL_TEXT_COMMITTED,
        version: SESSION_EVENT_VERSION,
        payload: {
          runId: 'run_effect143_a',
          messageId: 'assistant_dead',
          seq: 0,
          text: 'DEAD_TEXT_143',
        },
      },
    ]);
    callPiChatMock.mockImplementation(
      createScriptedPiChat([
        [
          { kind: 'text', text: 'continued from the executed call' },
          { kind: 'done', reason: 'stop' },
        ],
      ])
    );
    const providerCalls = callPiChatMock;

    const result = await service.retryAndExecute(target, 'run_effect143_a');

    if (!result.success) throw new Error(`retry failed: ${JSON.stringify(result)}`);
    const wire = JSON.stringify(providerCalls.mock.calls[0][1]);
    expect(wire).toContain(TASK_TEXT);
    expect(wire).toContain('call_effect143');
    expect(wire).toContain(EXECUTED_OUTPUT);
    expect(wire).not.toContain('DEAD_TEXT_143');
    expect(wire).toContain('report.txt');
    expect(result).toMatchObject({ success: true });
  });

  it('a denied execution pairs with its execution-denied result', async () => {
    seedRun('run_effect143_a', 'failed');
    recordInputFact();
    recordExecutedCall({
      approved: false,
      output: { type: 'text', value: 'execution denied by policy' },
    });
    callPiChatMock.mockImplementation(
      createScriptedPiChat([
        [
          { kind: 'text', text: 'acknowledged the denial' },
          { kind: 'done', reason: 'stop' },
        ],
      ])
    );
    const providerCalls = callPiChatMock;

    const result = await service.retryAndExecute(target, 'run_effect143_a');

    if (!result.success) throw new Error(`retry failed: ${JSON.stringify(result)}`);
    const wire = JSON.stringify(providerCalls.mock.calls[0][1]);
    expect(wire).toContain('execution denied by policy');
  });

  it('a requested-but-never-executed approval produces no pair (the model re-issues)', async () => {
    seedRun('run_effect143_a', 'failed');
    recordInputFact();
    recordExecutedCall({ executed: false });
    callPiChatMock.mockImplementation(
      createScriptedPiChat([
        [
          { kind: 'text', text: 're-ran the task' },
          { kind: 'done', reason: 'stop' },
        ],
      ])
    );
    const providerCalls = callPiChatMock;

    const result = await service.retryAndExecute(target, 'run_effect143_a');

    if (!result.success) throw new Error(`retry failed: ${JSON.stringify(result)}`);
    const wire = JSON.stringify(providerCalls.mock.calls[0][1]);
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
    callPiChatMock.mockImplementation(
      createScriptedPiChat([
        [
          { kind: 'text', text: 'must not run' },
          { kind: 'done', reason: 'stop' },
        ],
      ])
    );

    const result = await service.retryAndExecute(target, 'run_effect143_a');

    expect(result).toMatchObject({ success: false });
    expect(result.error).toContain('cannot be represented from the log');
  });

  it('the replay still shows the whole story for display while the retry continues', async () => {
    seedRun('run_effect143_a', 'failed');
    recordInputFact();
    recordExecutedCall();
    callPiChatMock.mockImplementation(
      createScriptedPiChat([
        [
          { kind: 'text', text: 'continued' },
          { kind: 'done', reason: 'stop' },
        ],
      ])
    );

    await service.retryAndExecute(target, 'run_effect143_a');

    const view = rebuildThreadViewFromEvents('thread_effect143');
    expect(view.events.filter(event => event.type === TOOL_EXECUTION_FINISHED)).toHaveLength(1);
    expect(view.turns.filter(turn => turn.status === 'completed').length).toBeGreaterThanOrEqual(1);
  });
});
