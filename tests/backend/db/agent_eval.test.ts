import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@iki/backend/db/database', () => ({
  getDb: vi.fn(),
}));

import { getDb } from '@iki/backend/db/database';
import {
  createEvalLabel,
  getEvalLabel,
  listEvalLabelsByRun,
  listEvalLabelsByStep,
  updateEvalLabel,
  deleteEvalLabel,
  listEvalLabelsByRunIds,
} from '@iki/backend/db/agent_eval';

const getDbMock = vi.mocked(getDb);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('agent_eval db', () => {
  it('creates a label with step_id', () => {
    const runMock = vi.fn();
    const prepareMock = vi.fn(() => ({ run: runMock }));
    getDbMock.mockReturnValue({ prepare: prepareMock } as unknown as ReturnType<typeof getDb>);

    const label = createEvalLabel({
      runId: 'run_1',
      stepId: 'step_1',
      label: 'correct',
      note: null,
    });

    const params = runMock.mock.calls[0][0] as Record<string, unknown>;
    expect(params.run_id).toBe('run_1');
    expect(params.step_id).toBe('step_1');
    expect(params.label).toBe('correct');
    expect(params.note).toBeNull();
    expect(label.runId).toBe('run_1');
    expect(label.stepId).toBe('step_1');
  });

  it('creates a run-level label with null step_id', () => {
    const runMock = vi.fn();
    const prepareMock = vi.fn(() => ({ run: runMock }));
    getDbMock.mockReturnValue({ prepare: prepareMock } as unknown as ReturnType<typeof getDb>);

    const label = createEvalLabel({
      runId: 'run_1',
      stepId: null,
      label: 'note',
      note: 'baseline run',
    });

    const params = runMock.mock.calls[0][0] as Record<string, unknown>;
    expect(params.step_id).toBeNull();
    expect(params.label).toBe('note');
  });

  it('lists labels by run', () => {
    const allMock = vi.fn(() => [
      {
        id: 'eval_1',
        run_id: 'run_1',
        step_id: 'step_1',
        label: 'correct',
        note: null,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'eval_2',
        run_id: 'run_1',
        step_id: null,
        label: 'note',
        note: 'general note',
        created_at: '2026-01-01T01:00:00.000Z',
        updated_at: '2026-01-01T01:00:00.000Z',
      },
    ]);
    const prepareMock = vi.fn(() => ({ all: allMock }));
    getDbMock.mockReturnValue({ prepare: prepareMock } as unknown as ReturnType<typeof getDb>);

    const labels = listEvalLabelsByRun('run_1');
    expect(labels).toHaveLength(2);
    expect(labels[0].label).toBe('correct');
    expect(labels[1].label).toBe('note');
    expect(labels[1].note).toBe('general note');
  });

  it('lists labels by step', () => {
    const allMock = vi.fn(() => [
      {
        id: 'eval_1',
        run_id: 'run_1',
        step_id: 'step_1',
        label: 'incorrect',
        note: null,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
      },
    ]);
    const prepareMock = vi.fn(() => ({ all: allMock }));
    getDbMock.mockReturnValue({ prepare: prepareMock } as unknown as ReturnType<typeof getDb>);

    const labels = listEvalLabelsByStep('step_1');
    expect(labels).toHaveLength(1);
    expect(labels[0].label).toBe('incorrect');
  });

  it('returns empty array for empty run_id', () => {
    expect(listEvalLabelsByRun('')).toEqual([]);
    expect(listEvalLabelsByRun('  ')).toEqual([]);
  });

  it('updates a label', () => {
    const runMock = vi.fn();
    // updateEvalLabel calls prepare twice: first for UPDATE, then getEvalLabel for SELECT
    const getMock = vi.fn(() => ({
      id: 'eval_1',
      run_id: 'run_1',
      step_id: 'step_1',
      label: 'correct',
      note: 'updated note',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-02T00:00:00.000Z',
    }));
    const prepareMock = vi.fn(() => ({ run: runMock, get: getMock }));
    getDbMock.mockReturnValue({ prepare: prepareMock } as unknown as ReturnType<typeof getDb>);

    const updated = updateEvalLabel('eval_1', { label: 'correct', note: 'updated note' });
    expect(updated?.label).toBe('correct');
    expect(updated?.note).toBe('updated note');
  });

  it('deletes a label and returns success', () => {
    const runMock = vi.fn(() => ({ changes: 1 }));
    const prepareMock = vi.fn(() => ({ run: runMock }));
    getDbMock.mockReturnValue({ prepare: prepareMock } as unknown as ReturnType<typeof getDb>);

    const result = deleteEvalLabel('eval_1');
    expect(result.success).toBe(true);
  });

  it('returns success false for empty label id', () => {
    expect(deleteEvalLabel('').success).toBe(false);
    expect(deleteEvalLabel('  ').success).toBe(false);
  });

  it('batches labels by run IDs', () => {
    const allMock = vi.fn(() => [
      {
        id: 'eval_1',
        run_id: 'run_1',
        step_id: 'step_1',
        label: 'correct',
        note: null,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'eval_2',
        run_id: 'run_2',
        step_id: 'step_2',
        label: 'incorrect',
        note: null,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
      },
    ]);
    const prepareMock = vi.fn(() => ({ all: allMock }));
    getDbMock.mockReturnValue({ prepare: prepareMock } as unknown as ReturnType<typeof getDb>);

    const map = listEvalLabelsByRunIds(['run_1', 'run_2']);
    expect(map.size).toBe(2);
    expect(map.get('run_1')).toHaveLength(1);
    expect(map.get('run_2')).toHaveLength(1);
  });
});
