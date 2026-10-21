import { describe, expect, it } from 'vitest';

import {
  EXECUTION_PLAN_VERSION,
  parseExecutionPlan,
  parseExecutionPlanValue,
  serializeExecutionPlan,
} from '@iki/backend/thread_session/execution_plan_codec';
import type { ExecutionPlan } from '@iki/backend/thread_session/execution_plan';

const validPlan: ExecutionPlan = {
  providerType: 'openai',
  providerId: 'provider_primary',
  model: 'test-model',
  enableTools: true,
  enabledTools: ['read_file', 'write_file'],
  availableSkillIds: ['skill_a'],
  requireApproval: true,
  autoApproveToolRequests: false,
  approvalPolicy: 'always',
  budget: { step: 12, batch: { max: 3, continuePrompt: 'keep going' } },
  maxInputTokens: 98000,
  maxOutputTokens: 2000,
  reasoningEffort: 'medium',
  systemPrompt: 'f3 system',
  contextTokens: 42,
  skillMode: 'auto',
  threadId: 'thread_f3',
  kind: 'chat-turn',
  runMetadata: {},
  transport: 'approval-resume',
  workspaceSelection: null,
};

describe('execution plan codec: the log path and the column path agree', () => {
  it('decodes a bare plan object — the shape a turn_started fact carries', () => {
    const decoded = parseExecutionPlanValue(validPlan);
    expect(decoded).not.toBeNull();
    expect(decoded).toEqual(validPlan);
    expect(decoded!.skillMode).toBe('auto');
    expect(decoded!.contextTokens).toBe(42);
  });

  it('decodes the wrapped {version, plan} form identically', () => {
    const wrapped = JSON.parse(serializeExecutionPlan(validPlan)) as unknown;
    expect(parseExecutionPlanValue(wrapped)).toEqual(validPlan);
    expect(parseExecutionPlan(serializeExecutionPlan(validPlan))).toEqual(validPlan);
  });

  it('rejects a wrapped plan from an unknown future version', () => {
    const future = { version: EXECUTION_PLAN_VERSION + 1, plan: validPlan };
    expect(parseExecutionPlanValue(future)).toBeNull();
  });

  it('rejects a structurally invalid plan rather than coercing it', () => {
    expect(parseExecutionPlanValue({ ...validPlan, model: undefined })).toBeNull();
    expect(parseExecutionPlanValue({ ...validPlan, enabledTools: 'read_file' })).toBeNull();
    expect(parseExecutionPlanValue({ ...validPlan, budget: undefined })).toBeNull();
    expect(parseExecutionPlanValue(null)).toBeNull();
    expect(parseExecutionPlanValue('not an object')).toBeNull();
  });
});
