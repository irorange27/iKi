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

it('shows a repeated system prompt once across turns', () => {
  const withPrompt = (id: string, createdAt: string, prompt: string): AgentRunTrace =>
    ({
      run: { ...run(id, createdAt, at(9)), systemPrompt: prompt } as AgentRun,
      steps: [],
      children: [],
    }) as AgentRunTrace;

  const ledgers = buildTurnLedgers([
    withPrompt('run_a', at(0), 'same prompt'),
    withPrompt('run_b', at(1), 'same prompt'),
    withPrompt('run_c', at(2), 'different prompt'),
  ]);

  const systemRows = ledgers.map(ledger =>
    ledger.entries.filter(entry => entry.type === 'system')
  );
  // The first turn introduces the prompt; the second repeats it and shows
  // nothing; the third changes it and shows the new one.
  expect(systemRows[0]).toHaveLength(1);
  expect(systemRows[1]).toHaveLength(0);
  expect(systemRows[2]).toHaveLength(1);
  expect(systemRows[2][0]!.summary).toContain('changed');
  expect(systemRows[2][0]!.summary).toContain('different prompt');
});


it('shows the inference step as the answer, with no separate completion row', () => {
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
    ]),
  ]);
  // Completion records the run row, not a step, so a finished turn is one row.
  expect(ledger.entries.map(entry => entry.type)).toEqual(['model']);
  expect(ledger.entries[0].summary).toBe('answer');
  expect(ledger.entries[0].reasoning).toBe('reason');
});

it('still labels a legacy completion step with its own type, not "finalize"', () => {
  // Rows written before completion stopped appending a step are still in old
  // databases. They carry type "model" and no `inference`; the projection used
  // to rename them to "finalize", which is what made every turn look like it
  // ended in a separate event.
  const [ledger] = buildTurnLedgers([
    trace('legacy', at(0), at(3), [
      step({ stepIndex: 0, startedAt: at(1), output: { inference: true, content: [{ type: 'text', text: 'answer' }] } }),
      step({ stepIndex: 1, startedAt: at(2), summary: 'Run completed successfully', output: { text: 'answer' } }),
    ]),
  ]);
  expect(ledger.entries.map(entry => entry.type)).toEqual(['model', 'model']);
  // The summary follows the step's own text, which is the same answer the
  // inference row already showed — that duplication is why it read as noise.
  expect(ledger.entries[1].summary).toBe('answer');
  expect(ledger.entries[1].step?.output).toEqual({ text: 'answer' });
});
