import type {
  AgentRun,
  AgentRunStep,
  AgentRunStepStatus,
  AgentRunStepType,
  AgentRunTrace,
} from '@iki/backend/types/agent_run';

export type LedgerKind = AgentRunStepType | 'system' | 'user';
export type LedgerLane = 0 | 1 | 2;
export type LedgerEntry = {
  id: string;
  step: AgentRunStep | null;
  index: number;
  type: LedgerKind;
  status: AgentRunStepStatus;
  summary: string;
  reasoning: string;
  input: unknown;
  output: unknown;
  startedAt: string;
  finishedAt: string | null;
  startedMs: number;
  durationMs: number | null;
  lane: LedgerLane;
  isError: boolean;
  searchText: string;
};
export type TurnLedger = {
  run: AgentRun;
  turn: number;
  entries: LedgerEntry[];
  startedMs: number;
  finishedMs: number;
  durationMs: number;
};
export type TimingSpan = { startedMs: number; finishedMs: number; durationMs: number };
export type TimelineMode = 'sequence' | 'time';
export type TimelineRange = { start: number; end: number };
export type TimelineItem = { entry: LedgerEntry; start: number; end: number };

const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
export const formatRecord = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (value == null) return '';
  return JSON.stringify(value, null, 2) ?? '';
};
const contentText = (value: unknown, kind = 'text'): string => {
  if (typeof value === 'string') return kind === 'text' ? value : '';
  if (!Array.isArray(value)) return '';
  return value
    .flatMap(part => {
      const item = record(part);
      return item.type === kind && typeof item.text === 'string' ? [item.text] : [];
    })
    .join('\n');
};
const toMs = (value: string | null | undefined): number | null => {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
};
export const laneFor = (type: LedgerKind): LedgerLane =>
  type === 'tool-call' || type === 'tool-result' ? 2 : type === 'model' ? 1 : 0;

export const buildTurnLedger = (trace: AgentRunTrace, turn: number): TurnLedger => {
  const runStart = toMs(trace.run.createdAt) ?? 0;
  const entries: LedgerEntry[] = [];
  const add = (entry: Omit<LedgerEntry, 'searchText'>) => {
    entries.push({
      ...entry,
      searchText: [
        entry.type,
        entry.summary,
        entry.reasoning,
        formatRecord(entry.input),
        formatRecord(entry.output),
      ]
        .join('\n')
        .toLocaleLowerCase(),
    });
  };
  const contextEntry = (type: 'system' | 'user', value: unknown, summary: string) =>
    add({
      id: `${trace.run.id}:${type}`,
      step: null,
      index: 0,
      type,
      status: 'completed',
      summary,
      reasoning: '',
      input: value,
      output: null,
      startedAt: trace.run.createdAt,
      finishedAt: null,
      startedMs: runStart,
      durationMs: null,
      lane: 0,
      isError: false,
    });
  if (trace.run.systemPrompt)
    contextEntry('system', trace.run.systemPrompt, trace.run.systemPrompt);
  const user = [...(trace.run.input?.messages ?? [])]
    .reverse()
    .map(record)
    .find(message => message.role === 'user');
  const prompt = user?.content ?? trace.run.input?.prompt;
  if (prompt != null) contextEntry('user', prompt, contentText(prompt) || formatRecord(prompt));

  [...trace.steps]
    .sort((a, b) => a.stepIndex - b.stepIndex)
    .forEach((step, index) => {
      const input = record(step.input);
      const output = record(step.output);
      const reasoning = contentText(output.content, 'reasoning');
      const type = step.type === 'model' && output.inference !== true ? 'finalize' : step.type;
      let summary = step.summary;
      if (type === 'model')
        summary = contentText(output.content) || contentText(output.text) || reasoning || summary;
      if (step.type === 'tool-call')
        summary = [input.toolName, formatRecord(input.input ?? input.args)]
          .filter(Boolean)
          .join(' ');
      if (step.type === 'tool-result')
        summary = [input.toolName, formatRecord(output.output)].filter(Boolean).join(' → ');
      if (step.type === 'error')
        summary = [input.toolName, formatRecord(output.error) || summary]
          .filter(Boolean)
          .join(' · ');
      const startedMs = toMs(step.startedAt) ?? runStart;
      const finishedMs = toMs(step.finishedAt);
      add({
        id: step.id,
        step,
        index: index + 1,
        type,
        status: step.status,
        summary,
        reasoning,
        input: step.input,
        output: step.output,
        startedAt: step.startedAt,
        finishedAt: step.finishedAt ?? null,
        startedMs,
        durationMs: finishedMs === null ? null : Math.max(0, finishedMs - startedMs),
        lane: laneFor(type),
        isError: step.type === 'error' || step.status === 'failed',
      });
    });
  const startedMs = Math.min(runStart, ...entries.map(entry => entry.startedMs));
  const finishedMs = Math.max(
    startedMs,
    toMs(trace.run.updatedAt) ?? startedMs,
    ...entries.map(entry => entry.startedMs + (entry.durationMs ?? 0))
  );
  return {
    run: trace.run,
    turn,
    entries,
    startedMs,
    finishedMs,
    durationMs: finishedMs - startedMs,
  };
};

export const buildTurnLedgers = (traces: AgentRunTrace[]): TurnLedger[] =>
  [...traces]
    .sort(
      (a, b) => a.run.createdAt.localeCompare(b.run.createdAt) || a.run.id.localeCompare(b.run.id)
    )
    .map((trace, index) => buildTurnLedger(trace, index + 1));
export const timingSpan = (ledgers: TurnLedger[]): TimingSpan => {
  if (!ledgers.length) return { startedMs: 0, finishedMs: 0, durationMs: 0 };
  const startedMs = Math.min(...ledgers.map(ledger => ledger.startedMs));
  const finishedMs = Math.max(...ledgers.map(ledger => ledger.finishedMs));
  return { startedMs, finishedMs, durationMs: finishedMs - startedMs };
};

// These are recorded timestamps, not inferred execution durations. Sequence
// gives instantaneous audit records equal, selectable space by default.
export const projectTimeline = (entries: LedgerEntry[], mode: TimelineMode): TimelineItem[] => {
  const origin = Math.min(...entries.map(entry => entry.startedMs));
  return entries.map((entry, index) => ({
    entry,
    start: mode === 'sequence' ? index : entry.startedMs - origin,
    end: mode === 'sequence' ? index + 1 : entry.startedMs - origin + (entry.durationMs ?? 0),
  }));
};
export const intersectsRange = (item: TimelineItem, range: TimelineRange): boolean =>
  item.start <= range.end && item.end >= range.start;
export const formatDuration = (ms: number | null): string => {
  if (ms === null) return '…';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const seconds = Math.round(ms / 1000);
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`;
};
