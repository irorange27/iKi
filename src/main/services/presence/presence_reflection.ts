import * as presenceDb from '../../../core/db/presence';
import * as presenceReflectionDb from '../../../core/db/presence_reflection';
import * as memoryDb from '../../../core/db/memory';
import * as tasksDb from '../../../core/db/tasks';
import * as todosDb from '../../../core/db/todos';
import { createLogger } from '../../../core/logger';
import { getToolModel, type ToolModelConfig } from '../../../core/provider/tool_model';
import { createSimplePromptTextGenerator } from '../../../core/runtimes/prompt_text_generator';
import type {
  PresenceEpisodeRecord,
  PresenceReflectionPeriodType,
  PresenceReflectionRecord,
  PresenceSleepWindow,
} from '../../../shared/types/presence';
import { parseJsonStringArray as parseRawJsonStringArray } from '../../../shared/utils/json';
import { getOrCreateActiveIdentityProfile } from '../identity/identity_service';
import { DEFAULT_SLEEP_WINDOW, normalizeSleepWindow } from './presence_activity_engine';

const MAX_HOURLY_BACKLOG_WINDOWS = 3;
const MAX_DAILY_BACKLOG_WINDOWS = 2;
const MAX_EPISODE_LINES = 16;
const MAX_REFLECTION_LINES = 8;
const MAX_TODO_LINES = 5;
const MAX_TASK_LINES = 5;
const MAX_PROMPT_CHARS = 7000;
const MAX_SUMMARY_CHARS = 320;
const MAX_LIST_ITEM_CHARS = 180;
const HOURLY_PERIOD_TYPE: PresenceReflectionPeriodType = 'hour';
const DAILY_PERIOD_TYPE: PresenceReflectionPeriodType = 'day';
const HOURLY_MEMORY_TAGS = ['presence-reflection', 'hourly-reflection'];
const DAILY_MEMORY_TAGS = ['presence-reflection', 'daily-reflection'];
const presenceReflectionLogger = createLogger({ module: 'presence_reflection' });

type ReflectionModelOutput = {
  summary: string;
  insights: string[];
  next_focus: string[];
  memory_candidate: string | null;
  memory_confidence: 'none' | 'low' | 'medium' | 'high';
};

type ReflectionWindow = {
  start: Date;
  end: Date;
};

type GeneratedPresenceReflection = {
  record: PresenceReflectionRecord;
  wroteMemory: boolean;
};

type ReflectionSourceBundle = {
  episodes: PresenceEpisodeRecord[];
  hourlyReflections?: PresenceReflectionRecord[];
  todoLines?: string[];
  taskLines?: string[];
};

type GenerateReflectionParams = {
  periodType: PresenceReflectionPeriodType;
  profileId: string;
  profileName: string;
  ownerName: string;
  periodStart: string;
  periodEnd: string;
  prompt: string;
  toolModel: ToolModelConfig;
  systemPrompt: string;
  maxTokens: number;
  memoryTags: string[];
  memoryEpisodes: PresenceEpisodeRecord[];
};

const HOURLY_SYSTEM_PROMPT = [
  'You write factual hourly reflections for iKi, a local AI companion with a structured presence runtime.',
  'Summarize only what the persisted episode trajectory supports.',
  'Focus on semantic activity, commitments, state drift, and what should matter next.',
  'Do not invent embodiment, fake emotions, or physical experiences.',
  'Output strict JSON only with this exact shape:',
  '{"summary":"string","insights":["string"],"next_focus":["string"],"memory_candidate":"string|null","memory_confidence":"none|low|medium|high"}',
  'Use memory_candidate only for durable, future-useful facts or patterns. Otherwise set it to null and confidence to "none".',
].join('\n');

const DAILY_SYSTEM_PROMPT = [
  'You write factual daily reflections and next-day planning notes for iKi, a local AI companion with a structured presence runtime.',
  'Summarize only what the persisted trajectory, hourly reflections, todo lists, and proactive commitments support.',
  'Focus on the day arc, repeated patterns, unresolved commitments, and the most valuable next-day priorities.',
  'Do not invent embodiment, fake emotions, or theatrical narrative.',
  'Output strict JSON only with this exact shape:',
  '{"summary":"string","insights":["string"],"next_focus":["string"],"memory_candidate":"string|null","memory_confidence":"none|low|medium|high"}',
  'Use next_focus for tomorrow-facing priorities.',
  'Use memory_candidate only for durable patterns worth long-term memory; otherwise use null and "none".',
].join('\n');

const normalizeWhitespace = (value: string): string =>
  value
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

const clipText = (value: string, maxChars: number): string => {
  if (!value) return '';
  const trimmed = normalizeWhitespace(value);
  if (trimmed.length <= maxChars) return trimmed;
  return `${trimmed.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`;
};

const toEpoch = (value: string | null | undefined): number | null => {
  if (!value?.trim()) return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
};

const isOnOrBefore = (value: string | null | undefined, cutoffIso: string): boolean => {
  const valueTime = toEpoch(value);
  const cutoffTime = toEpoch(cutoffIso);
  if (valueTime === null || cutoffTime === null) return false;
  return valueTime <= cutoffTime;
};

const sampleHeadTail = <T>(items: T[], maxItems: number): T[] => {
  if (items.length <= maxItems) return items;
  const headCount = Math.ceil(maxItems / 2);
  const tailCount = Math.floor(maxItems / 2);
  return [...items.slice(0, headCount), ...items.slice(items.length - tailCount)];
};

const parseJsonStringArray = (value: string | null | undefined): string[] =>
  parseRawJsonStringArray(value)
    .map(entry => clipText(entry, MAX_LIST_ITEM_CHARS))
    .filter(Boolean);

const extractJsonObject = (raw: string): string => {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const candidate = fenced?.[1]?.trim() || raw.trim();
  const firstBrace = candidate.indexOf('{');
  const lastBrace = candidate.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) return candidate;
  return candidate.slice(firstBrace, lastBrace + 1);
};

const parseReflectionModelOutput = (raw: string): ReflectionModelOutput | null => {
  if (!raw?.trim()) return null;
  try {
    const parsed = JSON.parse(extractJsonObject(raw)) as Partial<ReflectionModelOutput> | null;
    if (!parsed || typeof parsed !== 'object') return null;
    const insights = Array.isArray(parsed.insights)
      ? parsed.insights
          .filter((entry): entry is string => typeof entry === 'string')
          .map(entry => clipText(entry, MAX_LIST_ITEM_CHARS))
          .filter(Boolean)
          .slice(0, 4)
      : [];
    const nextFocus = Array.isArray(parsed.next_focus)
      ? parsed.next_focus
          .filter((entry): entry is string => typeof entry === 'string')
          .map(entry => clipText(entry, MAX_LIST_ITEM_CHARS))
          .filter(Boolean)
          .slice(0, 3)
      : [];
    const summary = clipText(typeof parsed.summary === 'string' ? parsed.summary : '', MAX_SUMMARY_CHARS);
    if (!summary) return null;
    const memoryCandidate =
      typeof parsed.memory_candidate === 'string' && parsed.memory_candidate.trim()
        ? clipText(parsed.memory_candidate, 220)
        : null;
    const memoryConfidence =
      parsed.memory_confidence === 'low' ||
      parsed.memory_confidence === 'medium' ||
      parsed.memory_confidence === 'high'
        ? parsed.memory_confidence
        : 'none';

    return {
      summary,
      insights,
      next_focus: nextFocus,
      memory_candidate: memoryCandidate,
      memory_confidence: memoryCandidate ? memoryConfidence : 'none',
    };
  } catch {
    return null;
  }
};

const floorToHour = (date: Date): Date => {
  const next = new Date(date);
  next.setMinutes(0, 0, 0);
  return next;
};

const shiftHours = (date: Date, hours: number): Date => {
  const next = new Date(date);
  next.setHours(next.getHours() + hours);
  return next;
};

const shiftDays = (date: Date, days: number): Date => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};

const buildHourlyWindows = (now: Date, limit = MAX_HOURLY_BACKLOG_WINDOWS): ReflectionWindow[] => {
  const closedHourEnd = floorToHour(now);
  const windows: ReflectionWindow[] = [];
  for (let index = limit; index >= 1; index -= 1) {
    const end = shiftHours(closedHourEnd, -(index - 1));
    const start = shiftHours(end, -1);
    windows.push({ start, end });
  }
  return windows;
};

const getSemanticDayBoundaryAtOrBefore = (date: Date, anchorHour: number): Date => {
  const boundary = new Date(date);
  boundary.setMinutes(0, 0, 0);
  boundary.setHours(anchorHour, 0, 0, 0);
  if (date.getTime() < boundary.getTime()) {
    boundary.setDate(boundary.getDate() - 1);
  }
  return boundary;
};

const buildDailyWindows = (
  now: Date,
  sleepWindow: PresenceSleepWindow,
  limit = MAX_DAILY_BACKLOG_WINDOWS
): ReflectionWindow[] => {
  const closedDayEnd = getSemanticDayBoundaryAtOrBefore(now, sleepWindow.startHour);
  const windows: ReflectionWindow[] = [];
  for (let index = limit; index >= 1; index -= 1) {
    const end = shiftDays(closedDayEnd, -(index - 1));
    const start = shiftDays(end, -1);
    windows.push({ start, end });
  }
  return windows;
};

const formatHourMinute = (value: string | null | undefined): string => {
  if (!value?.trim()) return 'unknown';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toISOString().slice(11, 16);
};

const formatDateTime = (value: string | null | undefined): string => {
  if (!value?.trim()) return 'unknown';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toISOString().slice(0, 16).replace('T', ' ');
};

const formatEpisodeLine = (episode: PresenceEpisodeRecord): string => {
  const refs = [
    episode.task_id ? `task=${episode.task_id}` : '',
    episode.thread_id ? `thread=${episode.thread_id}` : '',
    episode.trigger_type ? `trigger=${episode.trigger_type}` : '',
  ]
    .filter(Boolean)
    .join(', ');

  return [
    `${formatHourMinute(episode.started_at)} -> ${episode.ended_at ? formatHourMinute(episode.ended_at) : 'open'}`,
    `${episode.activity_type} / ${episode.presence}`,
    clipText(episode.summary || episode.transition_reason, 180),
    refs ? `[${refs}]` : '',
  ]
    .filter(Boolean)
    .join(' | ');
};

const buildEpisodesTranscript = (
  episodes: PresenceEpisodeRecord[],
  maxLines = MAX_EPISODE_LINES
): string => {
  const lines = sampleHeadTail(episodes, maxLines).map(formatEpisodeLine);
  return clipText(lines.join('\n'), MAX_PROMPT_CHARS);
};

const buildReflectionLines = (
  reflections: PresenceReflectionRecord[],
  maxLines = MAX_REFLECTION_LINES
): string[] =>
  sampleHeadTail(reflections, maxLines).map(reflection => {
    const insight = parseJsonStringArray(reflection.insights_json)[0];
    const plan = parseJsonStringArray(reflection.plan_json)[0];
    return clipText(
      [
        `${formatDateTime(reflection.period_start)} -> ${formatDateTime(reflection.period_end)}`,
        clipText(reflection.summary, 180),
        insight ? `insight=${insight}` : '',
        plan ? `next=${plan}` : '',
      ]
        .filter(Boolean)
        .join(' | '),
      260
    );
  });

const buildPendingTodoLines = (windowEnd: string): string[] => {
  const lists = todosDb
    .listTodoLists({ limit: MAX_TODO_LINES * 2 })
    .filter(list => isOnOrBefore(list.created_at, windowEnd))
    .slice(0, MAX_TODO_LINES);

  return lists
    .map(list => {
      const detail = todosDb.getTodoListById(list.id);
      const visibleItems =
        detail?.items.filter(item => isOnOrBefore(item.created_at, windowEnd)) ?? [];
      const pendingVisibleItems = visibleItems.filter(
        item => !item.completed_at || !isOnOrBefore(item.completed_at, windowEnd)
      );
      const pendingItems = pendingVisibleItems
        .slice(0, 2)
        .map(item => clipText(item.content, 60));
      if (pendingItems.length === 0) return '';

      const completedCount = visibleItems.length - pendingVisibleItems.length;
      const safeSummary = isOnOrBefore(list.updated_at, windowEnd) && list.summary
        ? clipText(list.summary, 90)
        : '';

      return clipText(
        [
          `${list.title} (${pendingVisibleItems.length} pending, ${Math.max(0, completedCount)} completed)`,
          safeSummary,
          pendingItems.length > 0 ? `next=${pendingItems.join('; ')}` : '',
        ]
          .filter(Boolean)
          .join(' | '),
        240
      );
    })
    .filter(Boolean);
};

const sortTasksForPlanning = (taskA: { next_run_at?: string | null }, taskB: { next_run_at?: string | null }) => {
  const timeA = taskA.next_run_at ? new Date(taskA.next_run_at).getTime() : Number.NEGATIVE_INFINITY;
  const timeB = taskB.next_run_at ? new Date(taskB.next_run_at).getTime() : Number.NEGATIVE_INFINITY;
  const normalizedA = Number.isFinite(timeA) ? timeA : Number.MAX_SAFE_INTEGER;
  const normalizedB = Number.isFinite(timeB) ? timeB : Number.MAX_SAFE_INTEGER;
  return normalizedA - normalizedB;
};

const buildProactiveTaskLines = (windowEnd: string): string[] =>
  tasksDb
    .getProactiveTasks()
    .filter(task => task.enabled && isOnOrBefore(task.created_at, windowEnd))
    .sort(sortTasksForPlanning)
    .slice(0, MAX_TASK_LINES)
    .map(task =>
      clipText(
        [
          task.name,
          isOnOrBefore(task.updated_at, windowEnd) ? `status=${task.last_status || 'idle'}` : '',
          isOnOrBefore(task.updated_at, windowEnd) && task.next_run_at
            ? `next=${formatDateTime(task.next_run_at)}`
            : '',
          task.thread_id ? `thread=${task.thread_id}` : '',
          isOnOrBefore(task.updated_at, windowEnd) &&
          task.last_status === 'error' &&
          task.last_error
            ? `error=${clipText(task.last_error, 80)}`
            : '',
        ]
          .filter(Boolean)
          .join(' | '),
        240
      )
    );

const isMeaningfulHourlyWindow = (episodes: PresenceEpisodeRecord[]): boolean => {
  if (episodes.length === 0) return false;
  if (episodes.length > 1) return true;
  return episodes.some(
    episode => episode.activity_type !== 'companion_idle' || Boolean(episode.task_id || episode.thread_id)
  );
};

const isMeaningfulDailyWindow = (bundle: ReflectionSourceBundle): boolean => {
  if (bundle.hourlyReflections && bundle.hourlyReflections.length > 0) return true;
  if (isMeaningfulHourlyWindow(bundle.episodes)) return true;
  if ((bundle.todoLines?.length || 0) > 0) return true;
  if ((bundle.taskLines?.length || 0) > 0) return true;
  return false;
};

const buildSection = (title: string, body: string): string => `${title}:\n${body}`;

const buildHourlyReflectionPrompt = (params: {
  episodes: PresenceEpisodeRecord[];
  periodStart: string;
  periodEnd: string;
  profileName: string;
  ownerName: string;
}): string => {
  const sections = [
    `Profile: ${params.profileName}`,
    `Owner label: ${params.ownerName || 'the user'}`,
    `Reflection window (ISO): ${params.periodStart} -> ${params.periodEnd}`,
    buildSection('Episode trajectory', buildEpisodesTranscript(params.episodes)),
    [
      'Write an hourly reflection from this trajectory.',
      'Prefer compact factual language.',
      'Capture the dominant arc, 1-4 insights, and 0-3 next-focus items.',
      'Only propose a memory_candidate when the hour revealed something durable enough to remember later.',
    ].join('\n'),
  ];

  return sections.join('\n\n');
};

const buildDailyReflectionPrompt = (params: {
  profileName: string;
  ownerName: string;
  periodStart: string;
  periodEnd: string;
  bundle: ReflectionSourceBundle;
}): string => {
  const sections = [
    `Profile: ${params.profileName}`,
    `Owner label: ${params.ownerName || 'the user'}`,
    `Reflection window (semantic day): ${params.periodStart} -> ${params.periodEnd}`,
  ];

  if (params.bundle.episodes.length > 0) {
    sections.push(buildSection('Episode trajectory', buildEpisodesTranscript(params.bundle.episodes)));
  }

  const reflectionLines = buildReflectionLines(params.bundle.hourlyReflections || []);
  if (reflectionLines.length > 0) {
    sections.push(buildSection('Hourly reflections', reflectionLines.join('\n')));
  }

  if ((params.bundle.todoLines?.length || 0) > 0) {
    sections.push(buildSection('Pending todo commitments', (params.bundle.todoLines || []).join('\n')));
  }

  if ((params.bundle.taskLines?.length || 0) > 0) {
    sections.push(
      buildSection('Proactive commitments', (params.bundle.taskLines || []).join('\n'))
    );
  }

  sections.push(
    [
      'Write a daily reflection and next-day plan from this evidence.',
      'Prefer compact factual language.',
      'Summarize the day arc, repeated patterns, unresolved commitments, and tomorrow-facing priorities.',
      'Only propose a memory_candidate when the day revealed a durable stable pattern worth retaining.',
    ].join('\n')
  );

  return clipText(sections.join('\n\n'), MAX_PROMPT_CHARS);
};

const resolveSingleThreadForMemoryWriteback = (episodes: PresenceEpisodeRecord[]): string | null => {
  const unique = Array.from(
    new Set(
      episodes
        .map(episode => episode.thread_id?.trim() || '')
        .filter(threadId => threadId.length > 0)
    )
  );
  return unique.length === 1 ? unique[0] : null;
};

const normalizeMemorySummary = (value: string): string => normalizeWhitespace(value).toLowerCase();

const shouldWriteReflectionMemory = (params: {
  reflection: ReflectionModelOutput;
  episodes: PresenceEpisodeRecord[];
}): { threadId: string; summary: string } | null => {
  if (!params.reflection.memory_candidate || params.reflection.memory_confidence !== 'high') {
    return null;
  }

  const threadId = resolveSingleThreadForMemoryWriteback(params.episodes);
  if (!threadId) return null;

  const normalizedCandidate = normalizeMemorySummary(params.reflection.memory_candidate);
  const existing = memoryDb.listLongMemory(threadId, 50);
  const duplicate = existing.some(entry => normalizeMemorySummary(entry.summary || '') === normalizedCandidate);
  if (duplicate) return null;

  return {
    threadId,
    summary: params.reflection.memory_candidate,
  };
};

const writeReflectionMemory = async (params: {
  reflectionRecord: PresenceReflectionRecord;
  reflection: ReflectionModelOutput;
  episodes: PresenceEpisodeRecord[];
  model: ToolModelConfig;
  memoryTags: string[];
}): Promise<boolean> => {
  const target = shouldWriteReflectionMemory({
    reflection: params.reflection,
    episodes: params.episodes,
  });
  if (!target) return false;

  const result = await memoryDb.addLongMemory({
    thread_id: target.threadId,
    summary: target.summary,
    tags: params.memoryTags,
    metadata: {
      source: 'presence-reflection',
      reflectionId: params.reflectionRecord.id,
      periodType: params.reflectionRecord.period_type,
      periodStart: params.reflectionRecord.period_start,
      model: params.model,
    },
  });
  return Boolean(result);
};

const generateReflection = async (
  params: GenerateReflectionParams
): Promise<GeneratedPresenceReflection | null> => {
  if (!params.prompt.trim()) return null;

  const generator = createSimplePromptTextGenerator({
    enabled: true,
    providerType: params.toolModel.providerType,
    model: params.toolModel.model,
    systemPrompt: params.systemPrompt,
    temperature: 0.15,
    maxTokens: params.maxTokens,
    maxIterations: 1,
    enableTools: false,
    enableMemory: false,
  });

  try {
    const result = await generator.generate(params.prompt);
    const reflection = parseReflectionModelOutput(result.response || '');
    if (!reflection) return null;

    const record = presenceReflectionDb.addPresenceReflection({
      profile_id: params.profileId,
      period_type: params.periodType,
      period_start: params.periodStart,
      period_end: params.periodEnd,
      summary: reflection.summary,
      insights_json: JSON.stringify(reflection.insights),
      plan_json: JSON.stringify(reflection.next_focus),
    });

    const wroteMemory = await writeReflectionMemory({
      reflectionRecord: record,
      reflection,
      episodes: params.memoryEpisodes,
      model: params.toolModel,
      memoryTags: params.memoryTags,
    });

    return {
      record,
      wroteMemory,
    };
  } catch (error) {
    presenceReflectionLogger.event({
      level: 'warn',
      event: 'life.reflection.generate',
      outcome: 'failed',
      error,
      entity: {
        period_type: params.periodType,
        profile_id: params.profileId,
      },
      data: {
        period_start: params.periodStart,
        period_end: params.periodEnd,
      },
    });
    return null;
  }
};

const getProfileSleepWindow = (profileId: string): PresenceSleepWindow => {
  const state = presenceDb.getPresenceState(profileId);
  if (!state?.sleep_window_json?.trim()) return { ...DEFAULT_SLEEP_WINDOW };

  try {
    return normalizeSleepWindow(JSON.parse(state.sleep_window_json));
  } catch {
    return { ...DEFAULT_SLEEP_WINDOW };
  }
};

const reflectionLocks = new Set<string>();

const runReflectionWindow = async (params: {
  profileId: string;
  profileName: string;
  ownerName: string;
  periodType: PresenceReflectionPeriodType;
  periodStart: string;
  periodEnd: string;
  prompt: string;
  toolModel: ToolModelConfig;
  systemPrompt: string;
  maxTokens: number;
  memoryTags: string[];
  memoryEpisodes: PresenceEpisodeRecord[];
}): Promise<GeneratedPresenceReflection | null> => {
  const lockKey = `${params.profileId}:${params.periodType}:${params.periodStart}`;
  if (reflectionLocks.has(lockKey)) return null;
  if (presenceReflectionDb.getPresenceReflection(params.profileId, params.periodType, params.periodStart)) {
    return null;
  }

  reflectionLocks.add(lockKey);
  try {
    return await generateReflection({
      periodType: params.periodType,
      profileId: params.profileId,
      profileName: params.profileName,
      ownerName: params.ownerName,
      periodStart: params.periodStart,
      periodEnd: params.periodEnd,
      prompt: params.prompt,
      toolModel: params.toolModel,
      systemPrompt: params.systemPrompt,
      maxTokens: params.maxTokens,
      memoryTags: params.memoryTags,
      memoryEpisodes: params.memoryEpisodes,
    });
  } finally {
    reflectionLocks.delete(lockKey);
  }
};

export const runDueHourlyRuntimeReflections = async (params?: {
  now?: string;
  maxWindows?: number;
}): Promise<GeneratedPresenceReflection[]> => {
  const profile = getOrCreateActiveIdentityProfile();
  if (!profile) return [];

  const toolModel = getToolModel();
  if (!toolModel) return [];

  const now = params?.now ? new Date(params.now) : new Date();
  if (Number.isNaN(now.getTime())) return [];

  const windows = buildHourlyWindows(now, params?.maxWindows);
  const results: GeneratedPresenceReflection[] = [];

  for (const window of windows) {
    const periodStart = window.start.toISOString();
    const periodEnd = window.end.toISOString();
    const episodes = presenceDb.listPresenceEpisodesInWindow(profile.id, periodStart, periodEnd);
    if (!isMeaningfulHourlyWindow(episodes)) continue;

    const prompt = buildHourlyReflectionPrompt({
      episodes,
      periodStart,
      periodEnd,
      profileName: profile.name,
      ownerName: profile.owner_name,
    });

    const generated = await runReflectionWindow({
      profileId: profile.id,
      profileName: profile.name,
      ownerName: profile.owner_name,
      periodType: HOURLY_PERIOD_TYPE,
      periodStart,
      periodEnd,
      prompt,
      toolModel,
      systemPrompt: HOURLY_SYSTEM_PROMPT,
      maxTokens: 420,
      memoryTags: HOURLY_MEMORY_TAGS,
      memoryEpisodes: episodes,
    });

    if (generated) {
      results.push(generated);
    }
  }

  return results;
};

export const runDueDailyRuntimeReflections = async (params?: {
  now?: string;
  maxWindows?: number;
}): Promise<GeneratedPresenceReflection[]> => {
  const profile = getOrCreateActiveIdentityProfile();
  if (!profile) return [];

  const toolModel = getToolModel();
  if (!toolModel) return [];

  const now = params?.now ? new Date(params.now) : new Date();
  if (Number.isNaN(now.getTime())) return [];

  const sleepWindow = getProfileSleepWindow(profile.id);
  const windows = buildDailyWindows(now, sleepWindow, params?.maxWindows);
  const results: GeneratedPresenceReflection[] = [];

  for (const window of windows) {
    const periodStart = window.start.toISOString();
    const periodEnd = window.end.toISOString();
    const episodes = presenceDb.listPresenceEpisodesInWindow(profile.id, periodStart, periodEnd);
    const hourlyReflections = presenceReflectionDb.listPresenceReflectionsInWindow({
      profileId: profile.id,
      periodType: HOURLY_PERIOD_TYPE,
      periodStart,
      periodEnd,
    });
    const todoLines = buildPendingTodoLines(periodEnd);
    const taskLines = buildProactiveTaskLines(periodEnd);

    if (!isMeaningfulDailyWindow({ episodes, hourlyReflections, todoLines, taskLines })) {
      continue;
    }

    const prompt = buildDailyReflectionPrompt({
      profileName: profile.name,
      ownerName: profile.owner_name,
      periodStart,
      periodEnd,
      bundle: {
        episodes,
        hourlyReflections,
        todoLines,
        taskLines,
      },
    });

    const generated = await runReflectionWindow({
      profileId: profile.id,
      profileName: profile.name,
      ownerName: profile.owner_name,
      periodType: DAILY_PERIOD_TYPE,
      periodStart,
      periodEnd,
      prompt,
      toolModel,
      systemPrompt: DAILY_SYSTEM_PROMPT,
      maxTokens: 520,
      memoryTags: DAILY_MEMORY_TAGS,
      memoryEpisodes: episodes,
    });

    if (generated) {
      results.push(generated);
    }
  }

  return results;
};

export const getRecentRuntimeReflectionContextMessage = (): string => {
  const profile = getOrCreateActiveIdentityProfile();
  if (!profile) return '';

  const dailyReflection = presenceReflectionDb.getLatestPresenceReflection(profile.id, DAILY_PERIOD_TYPE);
  const hourlyReflection = presenceReflectionDb.getLatestPresenceReflection(profile.id, HOURLY_PERIOD_TYPE);
  if (!dailyReflection && !hourlyReflection) return '';

  const lines = ['Recent runtime reflection for iKi:'];

  if (dailyReflection) {
    const insights = parseJsonStringArray(dailyReflection.insights_json).slice(0, 2);
    const plan = parseJsonStringArray(dailyReflection.plan_json).slice(0, 3);
    lines.push(`- Daily arc: ${clipText(dailyReflection.summary, MAX_SUMMARY_CHARS)}`);
    if (insights.length > 0) {
      lines.push('- Daily insights:');
      for (const item of insights) {
        lines.push(`  - ${item}`);
      }
    }
    if (plan.length > 0) {
      lines.push('- Next-day focus:');
      for (const item of plan) {
        lines.push(`  - ${item}`);
      }
    }
  }

  if (hourlyReflection) {
    const insights = parseJsonStringArray(hourlyReflection.insights_json).slice(0, 2);
    const plan = parseJsonStringArray(hourlyReflection.plan_json).slice(0, 2);
    lines.push(`- Hourly recap: ${clipText(hourlyReflection.summary, MAX_SUMMARY_CHARS)}`);
    if (insights.length > 0) {
      lines.push('- Near-term insights:');
      for (const item of insights) {
        lines.push(`  - ${item}`);
      }
    }
    if (plan.length > 0) {
      lines.push('- Near-term focus:');
      for (const item of plan) {
        lines.push(`  - ${item}`);
      }
    }
  }

  return lines.join('\n');
};
