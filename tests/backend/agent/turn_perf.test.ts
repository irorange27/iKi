import { describe, expect, it } from 'vitest';

import { addTurnPerf, AgentTurnPerfSchema } from '@iki/backend/agent/types';

describe('addTurnPerf', () => {
  it('returns the other side when one operand is missing', () => {
    const perf = AgentTurnPerfSchema.parse({
      llmMs: 100,
      toolMs: 20,
      firstTokenMs: 500,
      firstTokenSamples: 1,
      toolCalls: 2,
      steps: 3,
    });
    expect(addTurnPerf(undefined, perf)).toEqual(perf);
    expect(addTurnPerf(perf, undefined)).toEqual(perf);
    expect(addTurnPerf(undefined, undefined)).toBeUndefined();
  });

  it('sums every metric field', () => {
    const a = AgentTurnPerfSchema.parse({
      llmMs: 100,
      toolMs: 20,
      firstTokenMs: 500,
      firstTokenSamples: 1,
      toolCalls: 2,
      steps: 3,
    });
    const b = AgentTurnPerfSchema.parse({
      llmMs: 50,
      toolMs: 5,
      firstTokenMs: 250,
      firstTokenSamples: 2,
      toolCalls: 1,
      steps: 1,
    });

    expect(addTurnPerf(a, b)).toEqual({
      llmMs: 150,
      toolMs: 25,
      firstTokenMs: 750,
      firstTokenSamples: 3,
      toolCalls: 3,
      steps: 4,
    });
  });

  it('defaults missing metrics to zero', () => {
    expect(AgentTurnPerfSchema.parse({})).toEqual({
      llmMs: 0,
      toolMs: 0,
      firstTokenMs: 0,
      firstTokenSamples: 0,
      toolCalls: 0,
      steps: 0,
    });
  });
});
