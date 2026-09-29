import { describe, expect, it } from 'vitest';

import {
  deriveResumeStreamOptions,
  deriveRunTurnPlan,
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
    expect(plan.requireApproval).toBe(true);
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
      autonomous: { maxIterations: 10, continuePrompt: 'Continue.' },
    });

    // Regression: the pre-rehydrator inline assembly dropped both fields,
    // degrading resumed turns to legacy approval flags.
    expect(options.approvalPolicy).toBe('trustWorkspace');
    expect(options.maxIterations).toBe(12);
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
    expect(options.autonomous).toEqual({ maxIterations: 10, continuePrompt: 'Continue.' });
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
});
