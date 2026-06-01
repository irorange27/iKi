import { getDb } from './database';
import type { AgentEvalLabel, AgentEvalLabelType } from '../../shared/types/agent_run';
import { normalizeWhitespace, toIsoNow } from '../../shared/utils/text';
import { createPrefixedId } from '../../shared/utils/id';

type AgentEvalLabelRow = {
  id: string;
  run_id: string;
  step_id: string | null;
  label: string;
  note: string | null;
  created_at: string;
  updated_at: string;
};

const mapEvalLabelRow = (row: AgentEvalLabelRow): AgentEvalLabel => ({
  id: row.id,
  runId: row.run_id,
  stepId: row.step_id ?? null,
  label: row.label as AgentEvalLabelType,
  note: row.note ?? null,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export const createEvalLabel = (input: {
  runId: string;
  stepId?: string | null;
  label: AgentEvalLabelType;
  note?: string | null;
}): AgentEvalLabel => {
  const now = toIsoNow();
  const id = createPrefixedId('eval_');

  getDb()
    .prepare(
      `
        INSERT INTO agent_run_eval_labels (
          id, run_id, step_id, label, note, created_at, updated_at
        ) VALUES (
          @id, @run_id, @step_id, @label, @note, @created_at, @updated_at
        )
      `
    )
    .run({
      id,
      run_id: input.runId,
      step_id: input.stepId ?? null,
      label: input.label,
      note: input.note ?? null,
      created_at: now,
      updated_at: now,
    });

  return {
    id,
    runId: input.runId,
    stepId: input.stepId ?? null,
    label: input.label,
    note: input.note ?? null,
    createdAt: now,
    updatedAt: now,
  };
};

export const getEvalLabel = (id: string): AgentEvalLabel | null => {
  const normalizedId = normalizeWhitespace(id);
  if (!normalizedId) return null;

  const row = getDb()
    .prepare('SELECT * FROM agent_run_eval_labels WHERE id = ?')
    .get(normalizedId) as AgentEvalLabelRow | undefined;
  return row ? mapEvalLabelRow(row) : null;
};

export const listEvalLabelsByRun = (runId: string): AgentEvalLabel[] => {
  const normalizedRunId = normalizeWhitespace(runId);
  if (!normalizedRunId) return [];

  const rows = getDb()
    .prepare(
      'SELECT * FROM agent_run_eval_labels WHERE run_id = ? ORDER BY created_at ASC'
    )
    .all(normalizedRunId) as AgentEvalLabelRow[];
  return rows.map(mapEvalLabelRow);
};

export const listEvalLabelsByStep = (stepId: string): AgentEvalLabel[] => {
  const normalizedStepId = normalizeWhitespace(stepId);
  if (!normalizedStepId) return [];

  const rows = getDb()
    .prepare(
      'SELECT * FROM agent_run_eval_labels WHERE step_id = ? ORDER BY created_at ASC'
    )
    .all(normalizedStepId) as AgentEvalLabelRow[];
  return rows.map(mapEvalLabelRow);
};

export const updateEvalLabel = (
  id: string,
  updates: { label?: AgentEvalLabelType; note?: string | null }
): AgentEvalLabel | null => {
  const fields: string[] = [];
  const params: Record<string, unknown> = {
    id,
    updated_at: toIsoNow(),
  };

  if (updates.label !== undefined) {
    fields.push('label = @label');
    params.label = updates.label;
  }
  if (updates.note !== undefined) {
    fields.push('note = @note');
    params.note = updates.note;
  }

  if (fields.length === 0) {
    return getEvalLabel(id);
  }

  getDb()
    .prepare(
      `
        UPDATE agent_run_eval_labels
        SET ${fields.join(', ')}, updated_at = @updated_at
        WHERE id = @id
      `
    )
    .run(params);

  return getEvalLabel(id);
};

export const deleteEvalLabel = (id: string): { success: boolean } => {
  const normalizedId = normalizeWhitespace(id);
  if (!normalizedId) return { success: false };

  const result = getDb()
    .prepare('DELETE FROM agent_run_eval_labels WHERE id = ?')
    .run(normalizedId);

  return { success: result.changes > 0 };
};

export const listEvalLabelsByRunIds = (runIds: string[]): Map<string, AgentEvalLabel[]> => {
  const normalized = runIds
    .map(id => normalizeWhitespace(id))
    .filter(Boolean);

  if (normalized.length === 0) return new Map();

  const placeholders = normalized.map(() => '?').join(', ');

  const rows = getDb()
    .prepare(
      `
        SELECT * FROM agent_run_eval_labels
        WHERE run_id IN (${placeholders})
        ORDER BY run_id ASC, created_at ASC
      `
    )
    .all(...normalized) as AgentEvalLabelRow[];

  const labelsByRunId = new Map<string, AgentEvalLabel[]>();
  for (const row of rows) {
    const label = mapEvalLabelRow(row);
    const labels = labelsByRunId.get(label.runId);
    if (labels) {
      labels.push(label);
    } else {
      labelsByRunId.set(label.runId, [label]);
    }
  }

  return labelsByRunId;
};
