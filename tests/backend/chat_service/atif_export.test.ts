import { describe, expect, it, vi } from 'vitest';

const agentRunDbMocks = vi.hoisted(() => ({
  getAgentRun: vi.fn(),
  listAgentRunSteps: vi.fn(() => []),
}));

vi.mock('@iki/backend/db/agent_runs', () => ({
  getAgentRun: agentRunDbMocks.getAgentRun,
  listAgentRunSteps: agentRunDbMocks.listAgentRunSteps,
}));

import type { AgentRun, AgentRunStep } from '@iki/backend/types/agent_run';
import {
  buildRunTrajectory,
  exportRunTrajectory,
  validateAtifTrajectory,
} from '@iki/backend/chat_service/atif_export';

const fixtureRun = (): AgentRun => ({
  id: 'run_1',
  kind: 'chat-turn',
  status: 'completed',
  threadId: 'thread_1',
  parentRunId: null,
  rootRunId: 'run_1',
  providerType: 'openai',
  providerId: 'provider_primary',
  model: 'gpt-4o-mini',
  systemPrompt: 'system prompt',
  enabledTools: ['read_file'],
  availableSkillIds: [],
  input: { messages: [{ role: 'user', content: 'What is 2+2?' }] },
  working: { modelMessages: [], accumulatedText: '', pendingApprovalIds: [], lastStepIndex: 4 },
  output: {
    text: 'It is 4.',
    finishReason: 'completed',
    usage: {
      inputTokens: 100,
      outputTokens: 20,
      totalTokens: 120,
      cacheReadTokens: 10,
      cacheWriteTokens: 0,
      reasoningTokens: 0,
      estimatedCostUsd: 0.01,
    },
  },
  error: null,
  createdAt: '2026-09-03T00:00:00.000Z',
  updatedAt: '2026-09-03T00:01:00.000Z',
});

const fixtureStep = (
  stepIndex: number,
  type: AgentRunStep['type'],
  input: Record<string, unknown> | null,
  output: Record<string, unknown> | null
): AgentRunStep => ({
  id: `step_${stepIndex}`,
  runId: 'run_1',
  stepIndex,
  type,
  status: 'completed',
  summary: `step ${stepIndex}`,
  input,
  output,
  startedAt: '2026-09-03T00:00:01.000Z',
  finishedAt: '2026-09-03T00:00:01.000Z',
});

const fixtureSteps = (): AgentRunStep[] => [
  fixtureStep(1, 'tool-call', { toolCallId: 'call_1', toolName: 'read_file', input: { path: 'a.txt' } }, null),
  fixtureStep(2, 'tool-result', { toolCallId: 'call_1', toolName: 'read_file' }, { output: { content: 'file body' } }),
  fixtureStep(3, 'approval-request', { approvalId: 'appr_1', toolName: 'shell' }, null),
  fixtureStep(4, 'model', null, { text: 'It is 4.' }),
];

describe('buildRunTrajectory', () => {
  it('builds an ATIF trajectory: user step, merged tool observation, final agent message', () => {
    const trajectory = buildRunTrajectory(fixtureRun(), fixtureSteps());

    expect(trajectory.schema_version).toBe('ATIF-v1.8');
    expect(trajectory.session_id).toBe('run_1');
    expect(trajectory.agent.name).toBe('iKi');
    expect(trajectory.agent.model_name).toBe('openai/provider_primary/gpt-4o-mini');

    expect(trajectory.steps[0]).toMatchObject({ source: 'user', message: 'What is 2+2?' });

    const toolStep = trajectory.steps[1]!;
    expect(toolStep.source).toBe('agent');
    expect(toolStep.tool_calls).toEqual([
      { tool_call_id: 'call_1', function_name: 'read_file', arguments: { path: 'a.txt' } },
    ]);
    expect(toolStep.observation).toEqual({
      results: [{ source_call_id: 'call_1', content: { content: 'file body' } }],
    });

    const approvalStep = trajectory.steps[2]!;
    expect(approvalStep.extra?.approval_request).toEqual({ approvalId: 'appr_1', toolName: 'shell' });

    expect(trajectory.steps.at(-1)).toMatchObject({ source: 'agent', message: 'It is 4.' });
    expect(trajectory.final_metrics).toMatchObject({
      total_prompt_tokens: 100,
      total_completion_tokens: 20,
      total_cached_tokens: 10,
      total_cost_usd: 0.01,
      total_steps: trajectory.steps.length,
    });

    expect(validateAtifTrajectory(trajectory)).toEqual([]);
  });

  it('falls back to a system step when the run input has no user message', () => {
    const run = { ...fixtureRun(), input: {} };
    const trajectory = buildRunTrajectory(run, []);

    expect(trajectory.steps[0]).toMatchObject({ source: 'system' });
    expect(validateAtifTrajectory(trajectory)).toEqual([]);
  });
});

describe('validateAtifTrajectory', () => {
  it('rejects non-sequential step ids', () => {
    const trajectory = buildRunTrajectory(fixtureRun(), fixtureSteps());
    trajectory.steps[1]!.step_id = 7;
    const errors = validateAtifTrajectory(trajectory);
    expect(errors.some(e => e.includes('sequential from 1'))).toBe(true);
  });

  it('rejects agent-only fields on non-agent steps', () => {
    const trajectory = buildRunTrajectory(fixtureRun(), fixtureSteps());
    trajectory.steps[0]!.model_name = 'openai/gpt-4o-mini';
    const errors = validateAtifTrajectory(trajectory);
    expect(errors.some(e => e.includes('only allowed on agent steps'))).toBe(true);
  });

  it('rejects observations referencing unknown tool calls', () => {
    const trajectory = buildRunTrajectory(fixtureRun(), fixtureSteps());
    trajectory.steps[1]!.observation = { results: [{ source_call_id: 'call_missing', content: null }] };
    const errors = validateAtifTrajectory(trajectory);
    expect(errors.some(e => e.includes('unknown tool call'))).toBe(true);
  });
});

describe('exportRunTrajectory', () => {
  it('reports a missing run without throwing', () => {
    agentRunDbMocks.getAgentRun.mockReturnValue(null);
    expect(exportRunTrajectory('run_missing')).toEqual({
      success: false,
      errors: ['Run run_missing not found'],
    });
  });

  it('exports and validates a known run', () => {
    agentRunDbMocks.getAgentRun.mockReturnValue(fixtureRun());
    agentRunDbMocks.listAgentRunSteps.mockReturnValue(fixtureSteps());

    const result = exportRunTrajectory('run_1');
    expect(result.success).toBe(true);
    expect(result.errors).toBeUndefined();
    expect(result.trajectory?.steps.length).toBe(4);
  });
});
