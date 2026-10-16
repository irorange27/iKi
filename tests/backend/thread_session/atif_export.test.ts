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
} from '@iki/backend/thread_session/atif_export';

/** Every observation the trajectory exports, in step order. */
const observationsOf = (trajectory: ReturnType<typeof buildRunTrajectory>) =>
  trajectory.steps.flatMap(step => step.observation?.results ?? []);

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
      results: [{ source_call_id: 'call_1', content: JSON.stringify({ content: 'file body' }) }],
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

  it('exports inference boundaries once with paired errors and per-call usage', () => {
    const steps = [
      ...fixtureSteps().slice(0, 2),
      fixtureStep(3, 'model', {}, { inference: true, usage: { inputTokens: 12, outputTokens: 3 }, content: [
        { type: 'reasoning', text: 'Inspecting the failure' },
        { type: 'tool-call', toolCallId: 'call_1', toolName: 'read_file', input: { path: 'a.txt' } },
        { type: 'tool-error', toolCallId: 'call_1', error: 'missing file' },
      ] }),
      fixtureStep(4, 'model', {}, { text: 'aggregate should not duplicate inference' }),
    ];
    const trajectory = buildRunTrajectory(fixtureRun(), steps);
    expect(validateAtifTrajectory(trajectory)).toEqual([]);
    expect(trajectory.steps).toHaveLength(2);
    expect(trajectory.steps[1]).toMatchObject({
      reasoning_content: 'Inspecting the failure',
      metrics: { prompt_tokens: 12, completion_tokens: 3 },
      observation: { results: [{ source_call_id: 'call_1', content: '"missing file"' }] },
    });
  });

  it('never pairs a call with a later inference reusing the same call id', () => {
    // Provider call ids are unique only WITHIN a response: compat and
    // self-hosted endpoints reuse `call_1`-style ids freely. Keying the
    // observation index by call id alone would answer the first call with the
    // second call's result — fabricated provenance that still validates, so
    // nothing else would catch it.
    const steps = [
      fixtureStep(1, 'model', {}, { inference: true, usage: {}, content: [
        { type: 'tool-call', toolCallId: 'call_1', toolName: 'read_file', input: { path: 'first.txt' } },
      ] }),
      fixtureStep(2, 'tool-result', { toolCallId: 'call_1' }, { output: 'FIRST FILE BODY' }),
      fixtureStep(3, 'model', {}, { inference: true, usage: {}, content: [
        { type: 'tool-call', toolCallId: 'call_1', toolName: 'read_file', input: { path: 'second.txt' } },
      ] }),
      fixtureStep(4, 'tool-result', { toolCallId: 'call_1' }, { output: 'SECOND FILE BODY' }),
    ];

    const trajectory = buildRunTrajectory(fixtureRun(), steps);
    const callSteps = trajectory.steps.filter(step => step.tool_calls?.length);
    expect(callSteps).toHaveLength(2);
    expect(callSteps[0]!.observation).toEqual({
      results: [{ source_call_id: 'call_1', content: 'FIRST FILE BODY' }],
    });
    expect(callSteps[1]!.observation).toEqual({
      results: [{ source_call_id: 'call_1', content: 'SECOND FILE BODY' }],
    });
    expect(validateAtifTrajectory(trajectory)).toEqual([]);
  });

  it('pairs a repeated call id inside one inference in recorded order', () => {
    // A provider can repeat a call id WITHIN a single response: two tool-call
    // parts sharing one id, then two tool-result audit steps. Keying the
    // scoped index by (inference, call id) alone would collapse them, so both
    // calls report whichever result was indexed first — fabricated provenance
    // that still validates. The per-inference queue pairs the Nth call with
    // the Nth result.
    const duplicateCalls = [
      { type: 'tool-call', toolCallId: 'call_1', toolName: 'read_file', input: { path: 'first.txt' } },
      { type: 'tool-call', toolCallId: 'call_1', toolName: 'read_file', input: { path: 'second.txt' } },
    ];
    const buildRun = (first: string, second: string) => buildRunTrajectory(fixtureRun(), [
      fixtureStep(1, 'model', {}, { inference: true, usage: {}, content: duplicateCalls }),
      fixtureStep(2, 'tool-result', { toolCallId: 'call_1' }, { output: first }),
      fixtureStep(3, 'tool-result', { toolCallId: 'call_1' }, { output: second }),
    ]);

    const inOperandOrder = buildRun('FIRST FILE BODY', 'SECOND FILE BODY');
    expect(observationsOf(inOperandOrder)).toEqual([
      { source_call_id: 'call_1', content: 'FIRST FILE BODY' },
      { source_call_id: 'call_1', content: 'SECOND FILE BODY' },
    ]);
    expect(validateAtifTrajectory(inOperandOrder)).toEqual([]);

    // Reversed audit order: still two DISTINCT results, never one twice.
    const reversed = buildRun('SECOND FILE BODY', 'FIRST FILE BODY');
    expect(observationsOf(reversed).map(result => result.content).sort()).toEqual([
      'FIRST FILE BODY',
      'SECOND FILE BODY',
    ]);
    expect(validateAtifTrajectory(reversed)).toEqual([]);
  });

  it('never credits an inference call with a flat observation from a recurring id', () => {
    // An inference that recorded the call owns its pairing: when its own
    // results run out, the call is exported with NO observation rather than
    // one taken from the flat map — a flat entry for a recurring id may
    // belong to a different call, and crediting it here is the same
    // fabricated provenance this join exists to prevent.
    const steps = [
      fixtureStep(1, 'tool-call', { toolCallId: 'call_1', toolName: 'read_file', input: { path: 'legacy.txt' } }, null),
      fixtureStep(2, 'tool-result', { toolCallId: 'call_1' }, { output: 'LEGACY BODY' }),
      fixtureStep(3, 'model', {}, { inference: true, usage: {}, content: [
        { type: 'tool-call', toolCallId: 'call_1', toolName: 'read_file', input: { path: 'a.txt' } },
        { type: 'tool-call', toolCallId: 'call_1', toolName: 'read_file', input: { path: 'b.txt' } },
      ] }),
      fixtureStep(4, 'tool-result', { toolCallId: 'call_1' }, { output: 'ONE' }),
    ];

    const trajectory = buildRunTrajectory(fixtureRun(), steps);
    // With ownership resolved, ONE pairs with the inference's FIRST call
    // (the previous inference records the id), so it is used once and once
    // only — never handed to the trailing call as a duplicated observation.
    const contents = observationsOf(trajectory).map(o => o.content);
    expect(contents).toEqual(['LEGACY BODY', 'ONE']);
    expect(observationsOf(trajectory).filter(o => o.content === 'ONE')).toHaveLength(1);
    expect(validateAtifTrajectory(trajectory)).toEqual([]);
  });

  it('pairs legacy tool errors and keeps standalone errors valid', () => {
    const steps = [
      fixtureSteps()[0],
      fixtureStep(2, 'error', { toolCallId: 'call_1' }, { error: 'missing file' }),
      fixtureStep(3, 'error', null, { error: 'model failed' }),
    ];
    expect(validateAtifTrajectory(buildRunTrajectory(fixtureRun(), steps))).toEqual([]);
  });

  it('joins an AI-SDK-ordered observation (audit step BEFORE its inference)', () => {
    // The AI SDK emits tool parts DURING the stream and records the inference
    // at the step's end, so its audit order is tool-call -> tool-result ->
    // model(inference) — the reverse of the Pi path. The join must not depend
    // on the order: the observation belongs to whichever inference recorded
    // the call, in either direction.
    const steps = [
      fixtureStep(1, 'tool-call', { toolCallId: 'call_1', toolName: 'read_file', input: { path: 'a.txt' } }, null),
      fixtureStep(2, 'tool-result', { toolCallId: 'call_1' }, { output: 'AI SDK BODY' }),
      fixtureStep(3, 'model', {}, { inference: true, usage: { inputTokens: 10, outputTokens: 2 }, content: [
        { type: 'tool-call', toolCallId: 'call_1', toolName: 'read_file', input: { path: 'a.txt' } },
      ] }),
      fixtureStep(4, 'model', {}, { inference: true, usage: { inputTokens: 10, outputTokens: 2 }, content: [
        { type: 'text', text: 'It is 4.' },
      ] }),
    ];

    const trajectory = buildRunTrajectory(fixtureRun(), steps);
    const callStep = trajectory.steps.find(step =>
      step.tool_calls?.some(call => call.tool_call_id === 'call_1')
    );
    expect(callStep, 'the tool call must be exported').toBeDefined();
    expect(callStep!.observation).toEqual({
      results: [{ source_call_id: 'call_1', content: 'AI SDK BODY' }],
    });
    // The result's own audit step must not be emitted a second time.
    expect(trajectory.steps.filter(step => step.extra?.run_step_type === 'tool-result')).toHaveLength(0);
    expect(validateAtifTrajectory(trajectory)).toEqual([]);
  });

  it('keeps each call its own result when the AI SDK reuses a call id', () => {
    const steps = [
      fixtureStep(1, 'tool-call', { toolCallId: 'call_1', toolName: 'read_file', input: { path: 'first.txt' } }, null),
      fixtureStep(2, 'tool-result', { toolCallId: 'call_1' }, { output: 'FIRST' }),
      fixtureStep(3, 'model', {}, { inference: true, usage: {}, content: [
        { type: 'tool-call', toolCallId: 'call_1', toolName: 'read_file', input: { path: 'first.txt' } },
      ] }),
      fixtureStep(4, 'tool-call', { toolCallId: 'call_1', toolName: 'read_file', input: { path: 'second.txt' } }, null),
      fixtureStep(5, 'tool-result', { toolCallId: 'call_1' }, { output: 'SECOND' }),
      fixtureStep(6, 'model', {}, { inference: true, usage: {}, content: [
        { type: 'tool-call', toolCallId: 'call_1', toolName: 'read_file', input: { path: 'second.txt' } },
      ] }),
    ];

    const trajectory = buildRunTrajectory(fixtureRun(), steps);
    const observations = trajectory.steps.flatMap(step =>
      (step.observation?.results ?? []).map(result => result.content)
    );
    expect(observations).toEqual(['FIRST', 'SECOND']);
    expect(validateAtifTrajectory(trajectory)).toEqual([]);
  });

  it('joins a tool observation recorded in its own audit step', () => {
    // The Pi harness records a completed inference with only assistant parts
    // — text, reasoning, tool-call — and the tool result lands as a separate
    // `tool-result` audit step. Deriving the observation ONLY from the
    // inference content therefore drops it: the exported trajectory carries
    // the call and no observation, so a run cannot be replayed or audited
    // from the export.
    const steps = [
      fixtureSteps()[0],
      fixtureStep(2, 'model', {}, {
        inference: true,
        usage: { inputTokens: 10, outputTokens: 2 },
        content: [
          { type: 'text', text: 'Reading the file' },
          { type: 'tool-call', toolCallId: 'call_1', toolName: 'read_file', input: { path: 'a.txt' } },
        ],
      }),
      fixtureStep(3, 'tool-result', { toolCallId: 'call_1' }, { output: 'file body' }),
      fixtureStep(4, 'model', {}, { inference: true, usage: { inputTokens: 10, outputTokens: 2 }, content: [
        { type: 'text', text: 'It is 4.' },
      ] }),
    ];

    const trajectory = buildRunTrajectory(fixtureRun(), steps);

    const callStep = trajectory.steps.find(step =>
      step.tool_calls?.some(call => call.tool_call_id === 'call_1')
    );
    expect(callStep, 'the tool call must be exported').toBeDefined();
    expect(callStep!.observation).toEqual({
      results: [{ source_call_id: 'call_1', content: 'file body' }],
    });
    expect(validateAtifTrajectory(trajectory)).toEqual([]);
  });

  it('projects persisted approval decisions into the trajectory', () => {
    const trajectory = buildRunTrajectory(fixtureRun(), [
      fixtureStep(1, 'approval-request', { approvalId: 'appr_1', toolName: 'shell' }, null),
      fixtureStep(2, 'approval-response', {
        approvalId: 'appr_1',
        toolCallId: 'call_1',
        approved: false,
        reason: 'Denied by user',
      }, null),
    ]);

    expect(trajectory.steps[2]).toMatchObject({
      message: 'step 2',
      extra: {
        approval_response: {
          approvalId: 'appr_1',
          toolCallId: 'call_1',
          approved: false,
          reason: 'Denied by user',
        },
      },
    });
  });

  it('falls back to a system step when the run input has no user message', () => {
    const run = { ...fixtureRun(), input: {} };
    const trajectory = buildRunTrajectory(run, []);

    expect(trajectory.steps[0]).toMatchObject({ source: 'system' });
    expect(validateAtifTrajectory(trajectory)).toEqual([]);
  });

  it('omits the injected context envelope from the exported user step', () => {
    const run = {
      ...fixtureRun(),
      input: {
        messages: [
          {
            role: 'user',
            content:
              'What is 2+2?\n\n<system-reminder>\nAffect state: rushed.\n</system-reminder>',
          },
        ],
      },
    };
    const trajectory = buildRunTrajectory(run, []);

    expect(trajectory.steps[0].message).toBe('What is 2+2?');
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
    trajectory.steps[1]!.observation = { results: [{ source_call_id: 'call_missing', content: '' }] };
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
