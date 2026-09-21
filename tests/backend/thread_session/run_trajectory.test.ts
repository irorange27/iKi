// @vitest-environment node

import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const { getUserDataPathMock } = vi.hoisted(() => ({
  getUserDataPathMock: vi.fn(() => ''),
}));

vi.mock('@iki/backend/platform', () => ({
  getUserDataPath: getUserDataPathMock,
}));

const chatDb = await import('@iki/backend/db/chat_thread');
const agentRunDb = await import('@iki/backend/db/agent_runs');
const database = await import('@iki/backend/db/database');

const { createChatRuns } = await import('@iki/backend/thread_session/runs');

let dataDir = '';

describe('getRunTrajectory', () => {
  beforeAll(async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), 'iki-atif-ui-'));
    getUserDataPathMock.mockReturnValue(dataDir);
    database.initializeDatabase({ dbPath: path.join(dataDir, 'test.db') });

    chatDb.addChatThread({ id: 'thread_atif', title: 'ATIF thread', metadata: '{}' });

    agentRunDb.createAgentRun({
      id: 'run_atif',
      kind: 'proactive-task',
      status: 'completed',
      threadId: 'thread_atif',
      rootRunId: 'run_atif',
      providerType: 'openai',
      model: 'gpt-test',
      systemPrompt: '',
      enabledTools: ['web'],
      availableSkillIds: [],
      input: { messages: [{ role: 'user', content: 'Do the thing' }] },
      working: { modelMessages: [], accumulatedText: '', pendingApprovalIds: [], lastStepIndex: 0 },
      output: {
        text: 'done',
        usage: {
          inputTokens: 120,
          outputTokens: 40,
          cacheReadTokens: 10,
          estimatedCostUsd: 0.0021,
        },
      },
      error: null,
    });

    agentRunDb.appendAgentRunStep({
      id: 'step_atif_0',
      runId: 'run_atif',
      stepIndex: 0,
      type: 'tool-call',
      status: 'success',
      summary: 'Calling web',
      input: { toolCallId: 'call_1', toolName: 'web', input: { query: 'thing' } },
      startedAt: new Date().toISOString(),
    });
    agentRunDb.appendAgentRunStep({
      id: 'step_atif_1',
      runId: 'run_atif',
      stepIndex: 1,
      type: 'tool-result',
      status: 'success',
      summary: 'web ok',
      input: { toolCallId: 'call_1' },
      output: { output: { results: ['a link'] } },
      startedAt: new Date().toISOString(),
    });
  });

  afterAll(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  it('returns a structured ATIF trajectory for UI rendering', () => {
    const runs = createChatRuns({ abortActiveStream: vi.fn() });
    const trajectory = runs.getRunTrajectory('run_atif');

    expect(trajectory).not.toBeNull();
    expect(trajectory!.schema_version).toBe('ATIF-v1.8');
    expect(trajectory!.agent.model_name).toBe('openai/gpt-test');

    const first = trajectory!.steps[0]!;
    expect(first.source).toBe('user');
    expect(first.message).toBe('Do the thing');

    const toolStep = trajectory!.steps.find(step => (step.tool_calls?.length ?? 0) > 0);
    expect(toolStep).toBeDefined();
    expect(toolStep!.tool_calls![0]!.function_name).toBe('web');
    expect(toolStep!.observation?.results[0]?.content).toEqual(JSON.stringify({ results: ['a link'] }));
    expect((toolStep!.extra as Record<string, unknown>).run_step_index).toBe(0);

    expect(trajectory!.final_metrics).toMatchObject({
      total_prompt_tokens: 120,
      total_completion_tokens: 40,
      total_cached_tokens: 10,
      total_cost_usd: 0.0021,
    });
  });

  it('returns null for unknown runs', () => {
    const runs = createChatRuns({ abortActiveStream: vi.fn() });
    expect(runs.getRunTrajectory('missing')).toBeNull();
  });
});
