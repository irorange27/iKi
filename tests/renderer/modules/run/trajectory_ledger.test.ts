import { describe, expect, it } from 'vitest';

import type { AgentRun, AgentRunStep, AgentRunTrace } from '@iki/backend/types/agent_run';
import {
  buildTurnLedgers,
  formatDuration,
  timingSpan,
} from '../../../../packages/desktop/src/renderer/modules/run/trajectory_ledger';

const run = (id: string, createdAt: string, updatedAt: string): AgentRun =>
  ({ id, createdAt, updatedAt, status: 'completed' }) as AgentRun;

const step = (overrides: Partial<AgentRunStep> & Pick<AgentRunStep, 'stepIndex' | 'startedAt'>) =>
  ({
    id: `step_${overrides.stepIndex}`,
    type: 'model',
    status: 'completed',
    summary: `step ${overrides.stepIndex}`,
    finishedAt: overrides.startedAt,
    ...overrides,
  }) as AgentRunStep;

const trace = (
  id: string,
  createdAt: string,
  updatedAt: string,
  steps: AgentRunStep[]
): AgentRunTrace => ({ run: run(id, createdAt, updatedAt), steps, children: [] }) as AgentRunTrace;

const at = (second: number) => `2026-09-23T00:00:${String(second).padStart(2, '0')}.000Z`;

describe('buildTurnLedgers', () => {
  it('measures each step from startedAt to finishedAt and offsets it from the turn start', () => {
    const [turn] = buildTurnLedgers([
      trace('run_1', at(0), at(3), [
        step({ stepIndex: 0, startedAt: at(0), finishedAt: at(1) }),
        step({ stepIndex: 1, startedAt: at(1), finishedAt: at(1), type: 'tool-result' }),
        step({ stepIndex: 2, startedAt: at(1), finishedAt: at(3), type: 'tool-call' }),
      ]),
    ]);

    expect(turn.turn).toBe(1);
    expect(turn.entries.map(entry => entry.durationMs)).toEqual([1000, 0, 2000]);
    expect(turn.entries.map(entry => entry.startedMs)).toEqual([
      turn.entries[0].startedMs,
      turn.entries[0].startedMs + 1000,
      turn.entries[0].startedMs + 1000,
    ]);
    expect(turn.durationMs).toBe(3000);
  });

  it('numbers turns across traces and measures the shared timing span', () => {
    const ledgers = buildTurnLedgers([
      trace('run_1', at(0), at(2), [step({ stepIndex: 0, startedAt: at(0), finishedAt: at(2) })]),
      trace('run_2', at(5), at(6), [step({ stepIndex: 0, startedAt: at(5), finishedAt: at(6) })]),
    ]);

    expect(ledgers.map(ledger => ledger.turn)).toEqual([1, 2]);
    const span = timingSpan(ledgers);
    expect(span.startedMs).toBe(ledgers[0].startedMs);
    expect(span.durationMs).toBe(6000);
  });
});

describe('formatDuration', () => {
  it('scales the unit to the magnitude', () => {
    expect(formatDuration(null)).toBe('…');
    expect(formatDuration(840)).toBe('840ms');
    expect(formatDuration(1200)).toBe('1.2s');
    expect(formatDuration(125000)).toBe('2m 05s');
  });
});

it('orders run groups by creation rather than backend last-update order without mutating inputs', () => {
  const input = [trace('later', at(5), at(6), []), trace('earlier', at(0), at(9), [])];
  expect(buildTurnLedgers(input).map(ledger => ledger.run.id)).toEqual(['earlier', 'later']);
  expect(input[0].run.id).toBe('later');
});

it('does not invent a growing duration for an unfinished audit record in a terminal run', () => {
  const [ledger] = buildTurnLedgers([
    trace('ended', at(0), at(3), [step({ stepIndex: 0, startedAt: at(1), finishedAt: null })]),
  ]);
  expect(ledger.entries[0].durationMs).toBeNull();
  expect(ledger.durationMs).toBe(3000);
});

it('distinguishes completed inference output from the final aggregate record', () => {
  const [ledger] = buildTurnLedgers([
    trace('ended', at(0), at(3), [
      step({
        stepIndex: 0,
        startedAt: at(1),
        output: {
          inference: true,
          content: [
            { type: 'text', text: 'answer' },
            { type: 'reasoning', text: 'reason' },
          ],
        },
      }),
      step({
        stepIndex: 1,
        startedAt: at(2),
        summary: 'Run completed successfully',
        output: { text: 'answer' },
      }),
    ]),
  ]);
  expect(ledger.entries.map(entry => entry.type)).toEqual(['model', 'finalize']);
  expect(ledger.entries[0].summary).toBe('answer');
  expect(ledger.entries[0].reasoning).toBe('reason');
  expect(ledger.entries[1].summary).toBe('Run completed successfully');
  expect(ledger.entries[1].step?.output).toEqual({ text: 'answer' });
});
