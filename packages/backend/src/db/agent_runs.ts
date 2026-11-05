import { commitRows, readRows } from './collection';
import type {
  AgentRun,
  AgentRunError,
  AgentRunInput,
  AgentRunOutput,
  AgentRunStatus,
  AgentRunTrace,
  AgentRunStep,
  AgentRunWorkingState,
} from '@iki/backend/types/agent_run';
import { parseJsonOr } from '@iki/backend/utils/json';
import { normalizeWhitespace, toIsoNow } from '@iki/backend/utils/text';

type AgentRunRow = {
  id: string;
  kind: AgentRun['kind'];
  status: AgentRun['status'];
  thread_id?: string | null;
  parent_run_id?: string | null;
  root_run_id: string;
  provider_type: string;
  provider_id?: string | null;
  model: string;
  system_prompt: string;
  enabled_tools: string;
  available_skill_ids: string;
  input_json: string;
  working_json: string;
  output_json?: string | null;
  error_json?: string | null;
  created_at: string;
  updated_at: string;
};

type AgentRunStepRow = {
  id: string;
  run_id: string;
  step_index: number;
  type: AgentRunStep['type'];
  status: AgentRunStep['status'];
  summary: string;
  input_json?: string | null;
  output_json?: string | null;
  started_at: string;
  finished_at?: string | null;
};

const parseJsonValue = <T>(value: unknown, fallback: T): T =>
  parseJsonOr(value, parsed => parsed as T | null, fallback);

const normalizeStringArray = (value: unknown): string[] => {
  const parsed = Array.isArray(value) ? value : parseJsonValue<unknown[]>(value, []);
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map(entry => normalizeWhitespace(entry))
    .filter(Boolean)
    .filter((entry, index, entries) => entries.indexOf(entry) === index);
};

const normalizeInput = (value: unknown): AgentRunInput => {
  const parsed = parseJsonValue<Record<string, unknown>>(value, {});
  return {
    ...(typeof parsed.prompt === 'string' && parsed.prompt.trim()
      ? { prompt: parsed.prompt }
      : {}),
    ...(Array.isArray(parsed.messages) ? { messages: parsed.messages } : {}),
    ...(parsed.metadata && typeof parsed.metadata === 'object'
      ? { metadata: parsed.metadata as Record<string, unknown> }
      : {}),
  };
};

const normalizeWorking = (value: unknown): AgentRunWorkingState => {
  const parsed = parseJsonValue<Record<string, unknown>>(value, {});
  return {

    accumulatedText:
      typeof parsed.accumulatedText === 'string' ? parsed.accumulatedText : '',
    pendingApprovalIds: normalizeStringArray(parsed.pendingApprovalIds),
    lastStepIndex:
      typeof parsed.lastStepIndex === 'number' && Number.isFinite(parsed.lastStepIndex)
        ? Math.max(0, Math.trunc(parsed.lastStepIndex))
        : 0,
  };
};

const normalizeOutput = (value: unknown): AgentRunOutput | null => {
  const parsed = parseJsonValue<Record<string, unknown> | null>(value, null);
  if (!parsed || typeof parsed !== 'object') return null;
  return {
    ...(typeof parsed.text === 'string' ? { text: parsed.text } : {}),
    ...(typeof parsed.finishReason === 'string'
      ? { finishReason: parsed.finishReason }
      : {}),
    ...(parsed.usage && typeof parsed.usage === 'object'
      ? { usage: parsed.usage as Record<string, unknown> }
      : {}),

    ...(Array.isArray(parsed.pendingToolCalls)
      ? {
          pendingToolCalls: parsed.pendingToolCalls as NonNullable<
            AgentRunOutput['pendingToolCalls']
          >,
        }
      : {}),
  };
};

const normalizeError = (value: unknown): AgentRunError | null => {
  const parsed = parseJsonValue<Record<string, unknown> | null>(value, null);
  if (!parsed || typeof parsed !== 'object' || typeof parsed.message !== 'string') return null;
  return {
    message: parsed.message,
    ...(typeof parsed.code === 'string' ? { code: parsed.code } : {}),
    ...(typeof parsed.retryable === 'boolean' ? { retryable: parsed.retryable } : {}),
  };
};

const normalizeStepPayload = (value: unknown): Record<string, unknown> | null => {
  const parsed = parseJsonValue<Record<string, unknown> | null>(value, null);
  return parsed && typeof parsed === 'object' ? parsed : null;
};

const mapAgentRunRow = (row: AgentRunRow): AgentRun => ({
  id: row.id,
  kind: row.kind,
  status: row.status,
  threadId: row.thread_id ?? null,
  parentRunId: row.parent_run_id ?? null,
  rootRunId: row.root_run_id,
  providerType: row.provider_type,
  providerId: row.provider_id ?? null,
  model: row.model,
  systemPrompt: row.system_prompt,
  enabledTools: normalizeStringArray(row.enabled_tools),
  availableSkillIds: normalizeStringArray(row.available_skill_ids),
  input: normalizeInput(row.input_json),
  working: normalizeWorking(row.working_json),
  output: normalizeOutput(row.output_json),
  error: normalizeError(row.error_json),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const mapAgentRunStepRow = (row: AgentRunStepRow): AgentRunStep => ({
  id: row.id,
  runId: row.run_id,
  stepIndex: Math.max(0, Math.trunc(row.step_index)),
  type: row.type,
  status: row.status,
  summary: row.summary,
  input: normalizeStepPayload(row.input_json),
  output: normalizeStepPayload(row.output_json),
  startedAt: row.started_at,
  finishedAt: row.finished_at ?? null,
});

const RUNS = 'agent_runs';
const STEPS = 'agent_run_steps';

const runRowOf = (run: AgentRun, now: string): AgentRunRow => ({
  id: run.id,
  kind: run.kind,
  status: run.status,
  thread_id: normalizeWhitespace(run.threadId) || null,
  parent_run_id: normalizeWhitespace(run.parentRunId) || null,
  root_run_id: normalizeWhitespace(run.rootRunId) || run.id,
  provider_type: run.providerType,
  provider_id: normalizeWhitespace(run.providerId) || null,
  model: run.model,
  system_prompt: run.systemPrompt,
  enabled_tools: JSON.stringify(run.enabledTools ?? []),
  available_skill_ids: JSON.stringify(run.availableSkillIds ?? []),
  input_json: JSON.stringify(run.input ?? {}),
  working_json: JSON.stringify(run.working),
  output_json: run.output ? JSON.stringify(run.output) : null,
  error_json: run.error ? JSON.stringify(run.error) : null,
  created_at: now,
  updated_at: now,
});

export const createAgentRun = (
  input: Omit<AgentRun, 'createdAt' | 'updatedAt'>
): AgentRun => {
  const now = toIsoNow();
  const run: AgentRun = { ...input, createdAt: now, updatedAt: now };
  const rows = readRows<AgentRunRow>(RUNS).filter(row => row.id !== input.id);
  rows.push(runRowOf(run, now));
  commitRows(RUNS, rows);
  return run;
};

export const getAgentRun = (id: string): AgentRun | null => {
  const row = readRows<AgentRunRow>(RUNS).find(entry => entry.id === id);
  return row ? mapAgentRunRow(row) : null;
};

export const listAgentRunsByThread = (threadId: string): AgentRun[] => {
  const normalizedThreadId = normalizeWhitespace(threadId);
  if (!normalizedThreadId) return [];
  return readRows<AgentRunRow>(RUNS)
    .filter(row => row.thread_id === normalizedThreadId)
    .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)))
    .map(mapAgentRunRow);
};

export const listAgentRunsByStatus = (
  statuses: AgentRun['status'][],
  opts?: { clientId?: string; limit?: number }
): AgentRun[] => {
  const wanted = new Set(statuses.map(status => normalizeWhitespace(status)).filter(Boolean));
  if (wanted.size === 0) return [];

  let threadIds: Set<string> | null = null;
  if (opts?.clientId) {
    const clientId = normalizeWhitespace(opts.clientId);
    threadIds = new Set(
      readRows<{ id: string; client_id?: string | null }>('chat_threads')
        .filter(thread => normalizeWhitespace(thread.client_id) === clientId)
        .map(thread => thread.id)
    );
  }

  const matches = readRows<AgentRunRow>(RUNS)
    .filter(row => wanted.has(row.status))
    .filter(row => !threadIds || (typeof row.thread_id === 'string' && threadIds.has(row.thread_id)))
    .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));

  const limited =
    typeof opts?.limit === 'number' && opts.limit > 0 ? matches.slice(0, Math.trunc(opts.limit)) : matches;
  return limited.map(mapAgentRunRow);
};

export const listAgentRunsByParentRunId = (parentRunId: string): AgentRun[] => {
  const normalizedParentRunId = normalizeWhitespace(parentRunId);
  if (!normalizedParentRunId) return [];
  return readRows<AgentRunRow>(RUNS)
    .filter(row => row.parent_run_id === normalizedParentRunId)
    .sort(
      (a, b) =>
        String(a.created_at).localeCompare(String(b.created_at)) || a.id.localeCompare(b.id)
    )
    .map(mapAgentRunRow);
};

const patchRunRow = (
  row: AgentRunRow,
  updates: Partial<Omit<AgentRun, 'id' | 'createdAt' | 'updatedAt'>>
): AgentRunRow => {
  const next: AgentRunRow = { ...row, updated_at: toIsoNow() };
  if (updates.kind !== undefined) next.kind = updates.kind;
  if (updates.status !== undefined) next.status = updates.status;
  if (updates.threadId !== undefined) next.thread_id = normalizeWhitespace(updates.threadId) || null;
  if (updates.parentRunId !== undefined)
    next.parent_run_id = normalizeWhitespace(updates.parentRunId) || null;
  if (updates.rootRunId !== undefined)
    next.root_run_id = normalizeWhitespace(updates.rootRunId) || next.id;
  if (updates.providerType !== undefined) next.provider_type = updates.providerType;
  if (updates.providerId !== undefined)
    next.provider_id = normalizeWhitespace(updates.providerId) || null;
  if (updates.model !== undefined) next.model = updates.model;
  if (updates.systemPrompt !== undefined) next.system_prompt = updates.systemPrompt;
  if (updates.enabledTools !== undefined)
    next.enabled_tools = JSON.stringify(updates.enabledTools ?? []);
  if (updates.availableSkillIds !== undefined)
    next.available_skill_ids = JSON.stringify(updates.availableSkillIds ?? []);
  if (updates.input !== undefined) next.input_json = JSON.stringify(updates.input ?? {});
  if (updates.working !== undefined) next.working_json = JSON.stringify(updates.working);
  if (updates.output !== undefined)
    next.output_json = updates.output ? JSON.stringify(updates.output) : null;
  if (updates.error !== undefined)
    next.error_json = updates.error ? JSON.stringify(updates.error) : null;
  return next;
};

const writeRun = (row: AgentRunRow): void => {
  const rows = readRows<AgentRunRow>(RUNS);
  const index = rows.findIndex(entry => entry.id === row.id);
  if (index >= 0) rows[index] = row;
  else rows.push(row);
  commitRows(RUNS, rows);
};

export const updateAgentRun = (
  id: string,
  updates: Partial<Omit<AgentRun, 'id' | 'createdAt' | 'updatedAt'>>
): AgentRun | null => {
  const rows = readRows<AgentRunRow>(RUNS);
  const index = rows.findIndex(entry => entry.id === id);
  if (index < 0) return null;
  if (Object.keys(updates).length === 0) return mapAgentRunRow(rows[index] as AgentRunRow);
  const next = patchRunRow(rows[index] as AgentRunRow, updates);
  rows[index] = next;
  commitRows(RUNS, rows);
  return mapAgentRunRow(next);
};

const stepRowOf = (step: AgentRunStep): AgentRunStepRow => ({
  id: step.id,
  run_id: step.runId,
  step_index: step.stepIndex,
  type: step.type,
  status: step.status,
  summary: step.summary,
  input_json: step.input ? JSON.stringify(step.input) : null,
  output_json: step.output ? JSON.stringify(step.output) : null,
  started_at: step.startedAt,
  finished_at: step.finishedAt ?? null,
});

export const appendAgentRunStep = (step: AgentRunStep): AgentRunStep => {
  const rows = readRows<AgentRunStepRow>(STEPS).filter(entry => entry.id !== step.id);
  rows.push(stepRowOf(step));
  commitRows(STEPS, rows);
  return step;
};

export const claimQueuedAgentRun = (runId: string): AgentRun | null => {
  const normalized = normalizeWhitespace(runId);
  if (!normalized) return null;
  const rows = readRows<AgentRunRow>(RUNS);
  const index = rows.findIndex(entry => entry.id === normalized && entry.status === 'queued');
  if (index < 0) return null;
  const next: AgentRunRow = { ...(rows[index] as AgentRunRow), status: 'running', updated_at: toIsoNow() };
  rows[index] = next;
  commitRows(RUNS, rows);
  return mapAgentRunRow(next);
};

export const appendAgentRunStepAndUpdateRun = (
  step: AgentRunStep,
  updates: Partial<Omit<AgentRun, 'id' | 'createdAt' | 'updatedAt'>>
): AgentRun => {
  appendAgentRunStep(step);
  const updated = updateAgentRun(step.runId, updates);
  if (!updated) {
    throw new Error('Cannot update missing agent run "' + step.runId + '"');
  }
  return updated;
};

export const updateAgentRunIfStatus = (
  runId: string,
  updates: Partial<Omit<AgentRun, 'id' | 'createdAt' | 'updatedAt'>>,
  expectedStatuses: readonly AgentRunStatus[]
): AgentRun | null => {
  const rows = readRows<AgentRunRow>(RUNS);
  const index = rows.findIndex(
    entry => entry.id === runId && expectedStatuses.includes(entry.status)
  );
  if (index < 0) return null;
  const next = patchRunRow(rows[index] as AgentRunRow, updates);
  rows[index] = next;
  commitRows(RUNS, rows);
  return mapAgentRunRow(next);
};

export const listAgentRunSteps = (runId: string): AgentRunStep[] =>
  readRows<AgentRunStepRow>(STEPS)
    .filter(row => row.run_id === runId)
    .sort((a, b) => a.step_index - b.step_index)
    .map(mapAgentRunStepRow);

export const getAgentRunTrace = (runId: string): AgentRunTrace | null => {
  const normalizedRunId = normalizeWhitespace(runId);
  if (!normalizedRunId) return null;
  const run = getAgentRun(normalizedRunId);
  if (!run) return null;
  return {
    run,
    steps: listAgentRunSteps(normalizedRunId),
    children: listAgentRunsByParentRunId(normalizedRunId),
  };
};

export const cleanupOldAgentRuns = (maxAgeDays: number): { deletedRuns: number } => {
  const cutoffDate = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000).toISOString();
  const terminalStatuses = new Set<AgentRun['status']>(['completed', 'failed', 'cancelled']);
  const runs = readRows<AgentRunRow>(RUNS);
  const expired = runs.filter(
    row => terminalStatuses.has(row.status) && String(row.updated_at) < cutoffDate
  );
  if (expired.length === 0) return { deletedRuns: 0 };
  const expiredIds = new Set(expired.map(row => row.id));
  commitRows(RUNS, runs.filter(row => !expiredIds.has(row.id)));
  commitRows(STEPS, readRows<AgentRunStepRow>(STEPS).filter(row => !expiredIds.has(row.run_id)));
  return { deletedRuns: expired.length };
};
