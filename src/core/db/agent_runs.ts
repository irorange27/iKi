import { getDb } from './database';
import type {
  AgentRun,
  AgentRunCheckpoint,
  AgentRunError,
  AgentRunInput,
  AgentRunOutput,
  AgentRunStep,
  AgentRunWorkingState,
} from '../../shared/types/agent_run';
import { normalizeWhitespace, toIsoNow } from '../../shared/utils/text';

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

type AgentRunCheckpointRow = {
  id: string;
  run_id: string;
  step_index: number;
  reason: AgentRunCheckpoint['reason'];
  snapshot_json: string;
  created_at: string;
};

const parseJsonValue = <T>(value: unknown, fallback: T): T => {
  if (typeof value !== 'string' || !value.trim()) return fallback;
  try {
    const parsed = JSON.parse(value) as T;
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
};

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
    modelMessages: Array.isArray(parsed.modelMessages) ? parsed.modelMessages : [],
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

const mapAgentRunCheckpointRow = (row: AgentRunCheckpointRow): AgentRunCheckpoint => ({
  id: row.id,
  runId: row.run_id,
  stepIndex: Math.max(0, Math.trunc(row.step_index)),
  reason: row.reason,
  snapshot: mapAgentRunRow(
    parseJsonValue<AgentRunRow>(
      row.snapshot_json,
      {
        id: row.run_id,
        kind: 'chat-turn',
        status: 'failed',
        root_run_id: row.run_id,
        provider_type: '',
        model: '',
        system_prompt: '',
        enabled_tools: '[]',
        available_skill_ids: '[]',
        input_json: '{}',
        working_json: '{"modelMessages":[],"accumulatedText":"","pendingApprovalIds":[],"lastStepIndex":0}',
        created_at: row.created_at,
        updated_at: row.created_at,
      }
    )
  ),
  createdAt: row.created_at,
});

export const createAgentRun = (
  input: Omit<AgentRun, 'createdAt' | 'updatedAt'>
): AgentRun => {
  const now = toIsoNow();
  getDb()
    .prepare(
      `
        INSERT INTO agent_runs (
          id, kind, status, thread_id, parent_run_id, root_run_id, provider_type, provider_id,
          model, system_prompt, enabled_tools, available_skill_ids, input_json, working_json,
          output_json, error_json, created_at, updated_at
        ) VALUES (
          @id, @kind, @status, @thread_id, @parent_run_id, @root_run_id, @provider_type, @provider_id,
          @model, @system_prompt, @enabled_tools, @available_skill_ids, @input_json, @working_json,
          @output_json, @error_json, @created_at, @updated_at
        )
      `
    )
    .run({
      id: input.id,
      kind: input.kind,
      status: input.status,
      thread_id: normalizeWhitespace(input.threadId) || null,
      parent_run_id: normalizeWhitespace(input.parentRunId) || null,
      root_run_id: normalizeWhitespace(input.rootRunId) || input.id,
      provider_type: input.providerType,
      provider_id: normalizeWhitespace(input.providerId) || null,
      model: input.model,
      system_prompt: input.systemPrompt,
      enabled_tools: JSON.stringify(input.enabledTools ?? []),
      available_skill_ids: JSON.stringify(input.availableSkillIds ?? []),
      input_json: JSON.stringify(input.input ?? {}),
      working_json: JSON.stringify(input.working),
      output_json: input.output ? JSON.stringify(input.output) : null,
      error_json: input.error ? JSON.stringify(input.error) : null,
      created_at: now,
      updated_at: now,
    });

  return {
    ...input,
    createdAt: now,
    updatedAt: now,
  };
};

export const getAgentRun = (id: string): AgentRun | null => {
  const row = getDb()
    .prepare('SELECT * FROM agent_runs WHERE id = ?')
    .get(id) as AgentRunRow | undefined;
  return row ? mapAgentRunRow(row) : null;
};

export const listAgentRunsByThread = (threadId: string): AgentRun[] => {
  const normalizedThreadId = normalizeWhitespace(threadId);
  if (!normalizedThreadId) return [];

  const rows = getDb()
    .prepare('SELECT * FROM agent_runs WHERE thread_id = ? ORDER BY updated_at DESC')
    .all(normalizedThreadId) as AgentRunRow[];
  return rows.map(mapAgentRunRow);
};

export const updateAgentRun = (
  id: string,
  updates: Partial<Omit<AgentRun, 'id' | 'createdAt' | 'updatedAt'>>
): AgentRun | null => {
  const fields: string[] = [];
  const params: Record<string, unknown> = {
    id,
    updated_at: toIsoNow(),
  };

  if (updates.kind !== undefined) {
    fields.push('kind = @kind');
    params.kind = updates.kind;
  }
  if (updates.status !== undefined) {
    fields.push('status = @status');
    params.status = updates.status;
  }
  if (updates.threadId !== undefined) {
    fields.push('thread_id = @thread_id');
    params.thread_id = normalizeWhitespace(updates.threadId) || null;
  }
  if (updates.parentRunId !== undefined) {
    fields.push('parent_run_id = @parent_run_id');
    params.parent_run_id = normalizeWhitespace(updates.parentRunId) || null;
  }
  if (updates.rootRunId !== undefined) {
    fields.push('root_run_id = @root_run_id');
    params.root_run_id = normalizeWhitespace(updates.rootRunId) || id;
  }
  if (updates.providerType !== undefined) {
    fields.push('provider_type = @provider_type');
    params.provider_type = updates.providerType;
  }
  if (updates.providerId !== undefined) {
    fields.push('provider_id = @provider_id');
    params.provider_id = normalizeWhitespace(updates.providerId) || null;
  }
  if (updates.model !== undefined) {
    fields.push('model = @model');
    params.model = updates.model;
  }
  if (updates.systemPrompt !== undefined) {
    fields.push('system_prompt = @system_prompt');
    params.system_prompt = updates.systemPrompt;
  }
  if (updates.enabledTools !== undefined) {
    fields.push('enabled_tools = @enabled_tools');
    params.enabled_tools = JSON.stringify(updates.enabledTools ?? []);
  }
  if (updates.availableSkillIds !== undefined) {
    fields.push('available_skill_ids = @available_skill_ids');
    params.available_skill_ids = JSON.stringify(updates.availableSkillIds ?? []);
  }
  if (updates.input !== undefined) {
    fields.push('input_json = @input_json');
    params.input_json = JSON.stringify(updates.input ?? {});
  }
  if (updates.working !== undefined) {
    fields.push('working_json = @working_json');
    params.working_json = JSON.stringify(updates.working);
  }
  if (updates.output !== undefined) {
    fields.push('output_json = @output_json');
    params.output_json = updates.output ? JSON.stringify(updates.output) : null;
  }
  if (updates.error !== undefined) {
    fields.push('error_json = @error_json');
    params.error_json = updates.error ? JSON.stringify(updates.error) : null;
  }

  if (fields.length === 0) {
    return getAgentRun(id);
  }

  getDb()
    .prepare(
      `
        UPDATE agent_runs
        SET ${fields.join(', ')}, updated_at = @updated_at
        WHERE id = @id
      `
    )
    .run(params);

  return getAgentRun(id);
};

export const appendAgentRunStep = (step: AgentRunStep): AgentRunStep => {
  getDb()
    .prepare(
      `
        INSERT INTO agent_run_steps (
          id, run_id, step_index, type, status, summary, input_json, output_json,
          started_at, finished_at
        ) VALUES (
          @id, @run_id, @step_index, @type, @status, @summary, @input_json, @output_json,
          @started_at, @finished_at
        )
      `
    )
    .run({
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

  return step;
};

export const listAgentRunSteps = (runId: string): AgentRunStep[] => {
  const rows = getDb()
    .prepare('SELECT * FROM agent_run_steps WHERE run_id = ? ORDER BY step_index ASC')
    .all(runId) as AgentRunStepRow[];
  return rows.map(mapAgentRunStepRow);
};

export const createAgentRunCheckpoint = (
  checkpoint: Omit<AgentRunCheckpoint, 'createdAt'> & { createdAt?: string }
): AgentRunCheckpoint => {
  const createdAt = checkpoint.createdAt || toIsoNow();
  getDb()
    .prepare(
      `
        INSERT INTO agent_run_checkpoints (
          id, run_id, step_index, reason, snapshot_json, created_at
        ) VALUES (
          @id, @run_id, @step_index, @reason, @snapshot_json, @created_at
        )
      `
    )
    .run({
      id: checkpoint.id,
      run_id: checkpoint.runId,
      step_index: checkpoint.stepIndex,
      reason: checkpoint.reason,
      snapshot_json: JSON.stringify({
        id: checkpoint.snapshot.id,
        kind: checkpoint.snapshot.kind,
        status: checkpoint.snapshot.status,
        thread_id: checkpoint.snapshot.threadId ?? null,
        parent_run_id: checkpoint.snapshot.parentRunId ?? null,
        root_run_id: checkpoint.snapshot.rootRunId,
        provider_type: checkpoint.snapshot.providerType,
        provider_id: checkpoint.snapshot.providerId ?? null,
        model: checkpoint.snapshot.model,
        system_prompt: checkpoint.snapshot.systemPrompt,
        enabled_tools: JSON.stringify(checkpoint.snapshot.enabledTools),
        available_skill_ids: JSON.stringify(checkpoint.snapshot.availableSkillIds),
        input_json: JSON.stringify(checkpoint.snapshot.input ?? {}),
        working_json: JSON.stringify(checkpoint.snapshot.working),
        output_json: checkpoint.snapshot.output ? JSON.stringify(checkpoint.snapshot.output) : null,
        error_json: checkpoint.snapshot.error ? JSON.stringify(checkpoint.snapshot.error) : null,
        created_at: checkpoint.snapshot.createdAt,
        updated_at: checkpoint.snapshot.updatedAt,
      }),
      created_at: createdAt,
    });

  return {
    ...checkpoint,
    createdAt,
  };
};

export const getLatestAgentRunCheckpoint = (runId: string): AgentRunCheckpoint | null => {
  const row = getDb()
    .prepare(
      `
        SELECT * FROM agent_run_checkpoints
        WHERE run_id = ?
        ORDER BY step_index DESC, created_at DESC
        LIMIT 1
      `
    )
    .get(runId) as AgentRunCheckpointRow | undefined;

  return row ? mapAgentRunCheckpointRow(row) : null;
};
