import { describe, expect, it } from 'vitest';

import type { ExecutionPlan } from '@iki/backend/thread_session/execution_plan';
import {
  EXECUTION_PLAN_VERSION,
  parseExecutionPlan,
  serializeExecutionPlan,
} from '@iki/backend/thread_session/execution_plan_codec';

const validPlan: ExecutionPlan = {
  providerType: 'openai',
  model: 'test-model',
  enableTools: true,
  enabledTools: ['write_file'],
  availableSkillIds: [],
  guardActive: false,
  requireApproval: false,
  autoApproveToolRequests: false,
  maxIterations: 20,
  systemPrompt: 'system prompt',
  skillMode: 'manual',
  kind: 'chat-turn',
  runMetadata: {},
  transport: 'stream',
  threadId: 'thread_1',
};

// Persisted plan snapshots are versioned data: the codec is the single
// encode/decode pair, unknown versions and structurally invalid payloads
// fail closed (null) so callers take their declared legacy fallback.
describe('execution plan codec', () => {
  it('round-trips a plan through the versioned envelope', () => {
    const stored = serializeExecutionPlan(validPlan);
    expect(JSON.parse(stored)).toMatchObject({ version: EXECUTION_PLAN_VERSION });
    expect(parseExecutionPlan(stored)).toEqual(validPlan);
  });

  it('rejects unknown versions and malformed payloads', () => {
    expect(parseExecutionPlan(null)).toBeNull();
    expect(parseExecutionPlan('')).toBeNull();
    expect(parseExecutionPlan('not json')).toBeNull();
    expect(parseExecutionPlan(JSON.stringify({ version: 999, plan: validPlan }))).toBeNull();
    expect(parseExecutionPlan(JSON.stringify({ plan: validPlan }))).toBeNull();
    expect(parseExecutionPlan(JSON.stringify({ version: EXECUTION_PLAN_VERSION }))).toBeNull();
  });

  it('fails closed on plans missing harness-consumed fields', () => {
    const broken = { ...validPlan, enableTools: undefined } as unknown as ExecutionPlan;
    expect(parseExecutionPlan(serializeExecutionPlan(broken))).toBeNull();
    const noBudget = { ...validPlan, maxIterations: Number.NaN };
    expect(parseExecutionPlan(serializeExecutionPlan(noBudget))).toBeNull();
  });
});
