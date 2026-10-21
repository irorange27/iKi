import { describe, expect, it } from 'vitest';

import {
  deriveResumeStreamOptions,
  deriveRunTurnPlan,
  journaledExchangePairs,
} from '@iki/backend/thread_session/run_rehydrator';
import type { AgentRun } from '@iki/backend/types/agent_run';

const baseRun = {
  id: 'run_1',
  kind: 'chat-turn',
  status: 'blocked',
  threadId: 'thread_1',
  rootRunId: 'run_1',
  providerType: 'openai',
  providerId: 'prov_1',
  model: 'test-model',
  systemPrompt: 'system prompt',
  enabledTools: ['read_file', 'shell'],
  availableSkillIds: ['skill_a'],
  input: {
    metadata: {
      approvalPolicy: 'trustWorkspace',
      requireApproval: false,
      maxIterations: 12,
    },
  },
  working: {
    modelMessages: [],
    accumulatedText: '',
    pendingApprovalIds: ['appr_1'],
    lastStepIndex: 2,
  },
  output: null,
  error: null,
  createdAt: '2026-09-30T00:00:00.000Z',
  updatedAt: '2026-09-30T00:01:00.000Z',
} as unknown as AgentRun;

describe('deriveRunTurnPlan', () => {
  it('derives the turn plan from the run row metadata', () => {
    const plan = deriveRunTurnPlan(baseRun);
    expect(plan).toEqual({
      providerType: 'openai',
      providerId: 'prov_1',
      model: 'test-model',
      systemPrompt: 'system prompt',
      enabledTools: ['read_file', 'shell'],
      availableSkillIds: ['skill_a'],
      approvalPolicy: 'trustWorkspace',
      requireApproval: false,
      maxIterations: 12,
    });
  });

  it('falls back to the approval-session layer when the run row is missing', () => {
    const plan = deriveRunTurnPlan(null, {
      providerType: 'anthropic',
      providerId: '  ',
      model: 'fallback-model',
      systemPrompt: 'fallback prompt',
      enabledTools: ['web'],
      availableSkillIds: null,
      maxIterations: 5,
    });
    expect(plan.providerType).toBe('anthropic');
    expect(plan.providerId).toBeUndefined();
    expect(plan.model).toBe('fallback-model');
    expect(plan.systemPrompt).toBe('fallback prompt');
    expect(plan.enabledTools).toEqual(['web']);
    expect(plan.availableSkillIds).toEqual([]);
    expect(plan.approvalPolicy).toBeUndefined();
    expect(plan.requireApproval).toBeUndefined();
    expect(plan.maxIterations).toBe(5);
  });

  it('uses nullish semantics for arrays: an empty run array is a value, not a gap', () => {
    const run = {
      ...baseRun,
      enabledTools: [],
      availableSkillIds: [],
    } as unknown as AgentRun;
    const plan = deriveRunTurnPlan(run, { enabledTools: ['web'], availableSkillIds: ['skill_b'] });
    expect(plan.enabledTools).toEqual([]);
    expect(plan.availableSkillIds).toEqual([]);
  });
});

describe('deriveResumeStreamOptions', () => {
  it('restores the policy and iteration cap the original turn ran under', () => {
    const options = deriveResumeStreamOptions(baseRun, {
      kind: 'handoff-resume',
      parentRunId: 'run_1',
      metadata: { source: 'resume', originalRunId: 'run_1' },
      continuePrompt: 'Continue.',
    });

    // Regression: the pre-rehydrator inline assembly dropped these fields,
    // degrading resumed turns to legacy approval flags.
    expect(options.approvalPolicy).toBe('trustWorkspace');
    expect(options.requireApproval).toBe(false);
    expect(options.maxIterations).toBe(12);
    // A resume never invents a batch bound: `baseRun`'s metadata carries no
    // `autonomous`, so the resumed turn is a single batch. Supplying one in
    // the override used to inject a budget the original turn never ran under
    // (audit C-1: only the PROMPT may be overridden, and only for a turn that
    // already had a bound).
    expect(options.providerType).toBe('openai');
    expect(options.providerId).toBe('prov_1');
    expect(options.model).toBe('test-model');
    expect(options.messages).toEqual([]);
    expect(options.threadId).toBe('thread_1');
    expect(options.tools).toEqual(['read_file', 'shell']);
    expect(options.skillIds).toEqual(['skill_a']);
    expect(options.runConfig).toEqual({
      kind: 'handoff-resume',
      parentRunId: 'run_1',
      rootRunId: 'run_1',
      metadata: { source: 'resume', originalRunId: 'run_1' },
    });
    // No batch bound is reported because `baseRun` never stored one. The
    // override's `continuePrompt` cannot create one — it only re-words the
    // prompt of a bound the row already has.
    expect(options.autonomous).toBeUndefined();
  });

  it('omits optional fields the run does not carry', () => {
    const run = {
      ...baseRun,
      providerId: null,
      threadId: null,
      input: { metadata: {} },
    } as unknown as AgentRun;
    const options = deriveResumeStreamOptions(run, { kind: 'chat-turn' });
    expect(options).not.toHaveProperty('providerId');
    expect(options).not.toHaveProperty('approvalPolicy');
    expect(options).not.toHaveProperty('requireApproval');
    expect(options.threadId).toBeUndefined();
    expect(options.autonomous).toBeUndefined();
    expect(options.runConfig).toEqual({ kind: 'chat-turn', rootRunId: 'run_1' });
  });

  it('derives the same plan fields a recovery context would carry', () => {
    const plan = deriveRunTurnPlan(baseRun);
    const options = deriveResumeStreamOptions(baseRun, { kind: 'chat-turn' });
    expect(options.providerType).toBe(plan.providerType);
    expect(options.model).toBe(plan.model);
    expect(options.tools).toEqual(plan.enabledTools);
    expect(options.skillIds).toEqual(plan.availableSkillIds);
    expect(options.approvalPolicy).toBe(plan.approvalPolicy);
    expect(options.maxIterations).toBe(plan.maxIterations);
  });

  it('restores requireApproval=false even without a stored policy (Sourcery finding)', () => {
    const run = {
      ...baseRun,
      input: { metadata: { requireApproval: false } },
    } as unknown as AgentRun;
    const plan = deriveRunTurnPlan(run);
    expect(plan.approvalPolicy).toBeUndefined();
    expect(plan.requireApproval).toBe(false);
    const options = deriveResumeStreamOptions(run, { kind: 'chat-turn' });
    expect(options.requireApproval).toBe(false);
  });

  it('drops a non-finite restored autonomous iteration cap instead of clamping NaN', () => {
    const nanRun = {
      ...baseRun,
      input: { metadata: { autonomous: { maxIterations: Number.NaN, continuePrompt: 'go' } } },
    } as never;
    expect(deriveRunTurnPlan(nanRun).autonomous).toBeUndefined();
    const infiniteRun = {
      ...baseRun,
      input: { metadata: { autonomous: { maxIterations: Infinity } } },
    } as never;
    expect(deriveRunTurnPlan(infiniteRun).autonomous).toBeUndefined();
  });
});

describe('journaledExchangePairs: an unknown effect is not continuable', () => {
  const chainRunIds = ['run_dead_1'];
  const fact = (revision: number, type: string, payload: unknown) =>
    ({ revision, type, version: 1, createdAt: '2026-10-01T00:00:00.000Z', payload }) as never;

  const binding = {
    threadId: 'thread_1',
    approvalId: 'appr_unknown_1',
    toolCallId: 'call_unknown_1',
    toolName: 'write_file',
    args: { path: 'notes.md', content: 'original body' },
  };

  it('refuses when an execution started but its result was never recorded', () => {
    // The owner started the effect (a real write is now possible) and the
    // process died before recording the result. Silently dropping it lets the
    // retry re-issue the call — and re-issue means the effect may run twice.
    const events = [
      fact(1, 'approval_requested', { approvalId: binding.approvalId, runId: 'run_dead_1', toolName: 'write_file', toolCallId: binding.toolCallId, args: binding.args }),
      fact(2, 'tool_execution_prepared', { binding, decision: 'approved' }),
      fact(3, 'tool_execution_started', { binding, decision: 'approved' }),
    ];

    expect(() => journaledExchangePairs(events, chainRunIds)).toThrow(
      /never finished|unknown|outcome/i
    );
  });

  it('still continues an execution whose result WAS recorded', () => {
    const events = [
      fact(1, 'approval_requested', { approvalId: binding.approvalId, runId: 'run_dead_1', toolName: 'write_file', toolCallId: binding.toolCallId, args: binding.args }),
      fact(2, 'tool_execution_prepared', { binding, decision: 'approved' }),
      fact(3, 'tool_execution_started', { binding, decision: 'approved' }),
      fact(4, 'tool_execution_finished', {
        binding,
        decision: 'approved',
        result: {
          type: 'tool-result',
          toolCallId: binding.toolCallId,
          toolName: binding.toolName,
          output: { type: 'text', value: 'written' },
        },
      }),
    ];

    const pairs = journaledExchangePairs(events, chainRunIds);
    expect(pairs).toHaveLength(2);
    expect(pairs[0]).toMatchObject({ role: 'assistant' });
  });

  it('still replays an approval that never started: nothing happened, so nothing to reconcile', () => {
    // Requested and admitted but never STARTED — the effect never ran, so the
    // model legitimately re-asks and the current no-pair behavior is right.
    const events = [
      fact(1, 'approval_requested', { approvalId: binding.approvalId, runId: 'run_dead_1', toolName: 'write_file', toolCallId: binding.toolCallId, args: binding.args }),
      fact(2, 'tool_execution_prepared', { binding, decision: 'approved' }),
    ];

    expect(journaledExchangePairs(events, chainRunIds)).toEqual([]);
  });
});
