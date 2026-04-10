import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/core/db/database', () => ({
  getDb: vi.fn(),
}));

import { getDb } from '../../../src/core/db/database';
import {
  createAgentRun,
  getLatestAgentRunCheckpoint,
  listAgentRunSteps,
  updateAgentRun,
} from '../../../src/core/db/agent_runs';

const getDbMock = vi.mocked(getDb);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('agent_runs db', () => {
  it('serializes structured run payloads on insert', () => {
    const runMock = vi.fn();
    const prepareMock = vi.fn(() => ({ run: runMock }));
    getDbMock.mockReturnValue({ prepare: prepareMock } as unknown as ReturnType<typeof getDb>);

    const created = createAgentRun({
      id: 'run_1',
      kind: 'chat-turn',
      status: 'running',
      threadId: ' thread_1 ',
      parentRunId: ' ',
      rootRunId: 'run_1',
      providerType: 'openai',
      providerId: '',
      model: 'gpt-5.4',
      systemPrompt: 'system prompt',
      enabledTools: ['web'],
      availableSkillIds: ['user:planner'],
      input: {
        prompt: 'hello',
        messages: [{ role: 'user', content: 'hello' }],
        metadata: { transport: 'send' },
      },
      working: {
        modelMessages: [{ role: 'user', content: 'hello' }],
        accumulatedText: '',
        pendingApprovalIds: [],
        lastStepIndex: 0,
      },
      output: null,
      error: null,
    });

    const params = runMock.mock.calls[0][0] as Record<string, unknown>;
    expect(params.thread_id).toBe('thread_1');
    expect(params.parent_run_id).toBeNull();
    expect(params.provider_id).toBeNull();
    expect(params.enabled_tools).toBe('["web"]');
    expect(params.available_skill_ids).toBe('["user:planner"]');
    expect(params.input_json).toBe(
      JSON.stringify({
        prompt: 'hello',
        messages: [{ role: 'user', content: 'hello' }],
        metadata: { transport: 'send' },
      })
    );
    expect(params.working_json).toBe(
      JSON.stringify({
        modelMessages: [{ role: 'user', content: 'hello' }],
        accumulatedText: '',
        pendingApprovalIds: [],
        lastStepIndex: 0,
      })
    );
    expect(created.status).toBe('running');
    expect(typeof created.createdAt).toBe('string');
    expect(created.createdAt).toBe(created.updatedAt);
  });

  it('updates runs and maps stored steps/checkpoints back into typed records', () => {
    const updateRunMock = vi.fn();
    const selectRunMock = vi.fn(() => ({
      id: 'run_1',
      kind: 'chat-turn',
      status: 'blocked',
      thread_id: 'thread_1',
      parent_run_id: null,
      root_run_id: 'run_1',
      provider_type: 'openai',
      provider_id: null,
      model: 'gpt-5.4',
      system_prompt: 'system prompt',
      enabled_tools: '["web"]',
      available_skill_ids: '["user:planner"]',
      input_json: '{"prompt":"hello","metadata":{"transport":"stream"}}',
      working_json:
        '{"modelMessages":[{"role":"user","content":"hello"}],"accumulatedText":"partial","pendingApprovalIds":["approval_1"],"lastStepIndex":2}',
      output_json: '{"text":"partial","finishReason":"approval-requested"}',
      error_json: null,
      created_at: '2026-04-10T00:00:00.000Z',
      updated_at: '2026-04-10T00:00:10.000Z',
    }));
    const listStepsMock = vi.fn(() => [
      {
        id: 'step_1',
        run_id: 'run_1',
        step_index: 1,
        type: 'tool-call',
        status: 'completed',
        summary: 'Tool call web',
        input_json: '{"toolName":"web"}',
        output_json: null,
        started_at: '2026-04-10T00:00:01.000Z',
        finished_at: '2026-04-10T00:00:01.000Z',
      },
    ]);
    const getCheckpointMock = vi.fn(() => ({
      id: 'checkpoint_1',
      run_id: 'run_1',
      step_index: 2,
      reason: 'approval-requested',
      snapshot_json: JSON.stringify({
        id: 'run_1',
        kind: 'chat-turn',
        status: 'blocked',
        thread_id: 'thread_1',
        parent_run_id: null,
        root_run_id: 'run_1',
        provider_type: 'openai',
        provider_id: null,
        model: 'gpt-5.4',
        system_prompt: 'system prompt',
        enabled_tools: '["web"]',
        available_skill_ids: '["user:planner"]',
        input_json: '{"prompt":"hello"}',
        working_json:
          '{"modelMessages":[{"role":"user","content":"hello"}],"accumulatedText":"partial","pendingApprovalIds":["approval_1"],"lastStepIndex":2}',
        output_json: '{"text":"partial","finishReason":"approval-requested"}',
        error_json: null,
        created_at: '2026-04-10T00:00:00.000Z',
        updated_at: '2026-04-10T00:00:10.000Z',
      }),
      created_at: '2026-04-10T00:00:10.000Z',
    }));

    const prepareMock = vi.fn((sql: string) => {
      if (sql.includes('UPDATE agent_runs')) return { run: updateRunMock };
      if (sql.includes('SELECT * FROM agent_runs WHERE id')) return { get: selectRunMock };
      if (sql.includes('SELECT * FROM agent_run_steps')) return { all: listStepsMock };
      if (sql.includes('SELECT * FROM agent_run_checkpoints')) return { get: getCheckpointMock };
      return { run: vi.fn(), get: vi.fn(), all: vi.fn() };
    });

    getDbMock.mockReturnValue({ prepare: prepareMock } as unknown as ReturnType<typeof getDb>);

    const updated = updateAgentRun('run_1', {
      status: 'blocked',
      working: {
        modelMessages: [{ role: 'user', content: 'hello' }],
        accumulatedText: 'partial',
        pendingApprovalIds: ['approval_1'],
        lastStepIndex: 2,
      },
      output: {
        text: 'partial',
        finishReason: 'approval-requested',
      },
    });

    const updateParams = updateRunMock.mock.calls[0][0] as Record<string, unknown>;
    expect(updateParams.status).toBe('blocked');
    expect(updateParams.working_json).toBe(
      '{"modelMessages":[{"role":"user","content":"hello"}],"accumulatedText":"partial","pendingApprovalIds":["approval_1"],"lastStepIndex":2}'
    );
    expect(updated).toEqual({
      id: 'run_1',
      kind: 'chat-turn',
      status: 'blocked',
      threadId: 'thread_1',
      parentRunId: null,
      rootRunId: 'run_1',
      providerType: 'openai',
      providerId: null,
      model: 'gpt-5.4',
      systemPrompt: 'system prompt',
      enabledTools: ['web'],
      availableSkillIds: ['user:planner'],
      input: {
        prompt: 'hello',
        metadata: { transport: 'stream' },
      },
      working: {
        modelMessages: [{ role: 'user', content: 'hello' }],
        accumulatedText: 'partial',
        pendingApprovalIds: ['approval_1'],
        lastStepIndex: 2,
      },
      output: {
        text: 'partial',
        finishReason: 'approval-requested',
      },
      error: null,
      createdAt: '2026-04-10T00:00:00.000Z',
      updatedAt: '2026-04-10T00:00:10.000Z',
    });

    expect(listAgentRunSteps('run_1')).toEqual([
      {
        id: 'step_1',
        runId: 'run_1',
        stepIndex: 1,
        type: 'tool-call',
        status: 'completed',
        summary: 'Tool call web',
        input: { toolName: 'web' },
        output: null,
        startedAt: '2026-04-10T00:00:01.000Z',
        finishedAt: '2026-04-10T00:00:01.000Z',
      },
    ]);

    expect(getLatestAgentRunCheckpoint('run_1')).toEqual({
      id: 'checkpoint_1',
      runId: 'run_1',
      stepIndex: 2,
      reason: 'approval-requested',
      snapshot: {
        id: 'run_1',
        kind: 'chat-turn',
        status: 'blocked',
        threadId: 'thread_1',
        parentRunId: null,
        rootRunId: 'run_1',
        providerType: 'openai',
        providerId: null,
        model: 'gpt-5.4',
        systemPrompt: 'system prompt',
        enabledTools: ['web'],
        availableSkillIds: ['user:planner'],
        input: {
          prompt: 'hello',
        },
        working: {
          modelMessages: [{ role: 'user', content: 'hello' }],
          accumulatedText: 'partial',
          pendingApprovalIds: ['approval_1'],
          lastStepIndex: 2,
        },
        output: {
          text: 'partial',
          finishReason: 'approval-requested',
        },
        error: null,
        createdAt: '2026-04-10T00:00:00.000Z',
        updatedAt: '2026-04-10T00:00:10.000Z',
      },
      createdAt: '2026-04-10T00:00:10.000Z',
    });
  });
});
