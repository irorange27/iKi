import { commitRows, patchRow, readRows, removeRow } from './collection';
import type { AgentEvalLabel, AgentEvalLabelType } from '@iki/core/types/agent_run';
import { normalizeWhitespace, toIsoNow } from '@iki/core/utils/text';
import { createPrefixedId } from '@iki/core/utils/id';

type AgentEvalLabelRow = {
  id: string;
  run_id: string;
  step_id: string | null;
  label: string;
  note: string | null;
  created_at: string;
  updated_at: string;
};

const COLLECTION = 'agent_run_eval_labels';

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
  const rows = readRows<AgentEvalLabelRow>(COLLECTION);
  rows.push({
    id,
    run_id: input.runId,
    step_id: input.stepId ?? null,
    label: input.label,
    note: input.note ?? null,
    created_at: now,
    updated_at: now,
  });
  commitRows(COLLECTION, rows);
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
  const row = readRows<AgentEvalLabelRow>(COLLECTION).find(entry => entry.id === normalizedId);
  return row ? mapEvalLabelRow(row) : null;
};

export const listEvalLabelsByRun = (runId: string): AgentEvalLabel[] => {
  const normalizedRunId = normalizeWhitespace(runId);
  if (!normalizedRunId) return [];
  return readRows<AgentEvalLabelRow>(COLLECTION)
    .filter(row => row.run_id === normalizedRunId)
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map(mapEvalLabelRow);
};

export const listEvalLabelsByStep = (stepId: string): AgentEvalLabel[] => {
  const normalizedStepId = normalizeWhitespace(stepId);
  if (!normalizedStepId) return [];
  return readRows<AgentEvalLabelRow>(COLLECTION)
    .filter(row => row.step_id === normalizedStepId)
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map(mapEvalLabelRow);
};

export const updateEvalLabel = (
  id: string,
  updates: { label?: AgentEvalLabelType; note?: string | null }
): AgentEvalLabel | null => {
  const patch: Record<string, unknown> = {};
  if (updates.label !== undefined) patch.label = updates.label;
  if (updates.note !== undefined) patch.note = updates.note;
  if (Object.keys(patch).length === 0) return getEvalLabel(id);
  patchRow<AgentEvalLabelRow>(COLLECTION, 'id', id, patch);
  return getEvalLabel(id);
};

export const deleteEvalLabel = (id: string): { success: boolean } => {
  const normalizedId = normalizeWhitespace(id);
  if (!normalizedId) return { success: false };
  return { success: removeRow<AgentEvalLabelRow>(COLLECTION, 'id', normalizedId) > 0 };
};

export const listEvalLabelsByRunIds = (runIds: string[]): Map<string, AgentEvalLabel[]> => {
  const wanted = new Set(runIds.map(id => normalizeWhitespace(id)).filter(Boolean));
  const labelsByRunId = new Map<string, AgentEvalLabel[]>();
  if (wanted.size === 0) return labelsByRunId;
  const rows = readRows<AgentEvalLabelRow>(COLLECTION)
    .filter(row => wanted.has(row.run_id))
    .sort((a, b) => a.run_id.localeCompare(b.run_id) || a.created_at.localeCompare(b.created_at));
  for (const row of rows) {
    const label = mapEvalLabelRow(row);
    const existing = labelsByRunId.get(label.runId);
    if (existing) existing.push(label);
    else labelsByRunId.set(label.runId, [label]);
  }
  return labelsByRunId;
};
