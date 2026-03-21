import * as lifeDb from '../../../core/db/life';
import * as lifeReflectionDb from '../../../core/db/life_reflection';
import * as memoryDb from '../../../core/db/memory';
import { getToolModel, type ToolModelConfig } from '../../../core/provider/tool_model';
import { createSimplePromptTextGenerator } from '../../../core/runtimes/prompt_text_generator';
import type {
  LifeEpisodeRecord,
  LifeReflectionRecord,
  LifeReflectionPeriodType,
} from '../../../shared/types/life';
import { getOrCreateActiveIdentityProfile } from '../identity/identity_service';

const MAX_HOURLY_BACKLOG_WINDOWS = 3;
const MAX_EPISODE_LINES = 16;
const MAX_PROMPT_CHARS = 7000;
const MAX_SUMMARY_CHARS = 320;
const MAX_LIST_ITEM_CHARS = 180;
const MEMORY_TAGS = ['life-reflection', 'hourly-reflection'];
const HOURLY_PERIOD_TYPE: LifeReflectionPeriodType = 'hour';

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

type GeneratedLifeReflection = {
  record: LifeReflectionRecord;
  wroteMemory: boolean;
};

const SYSTEM_PROMPT = [
  'You write factual hourly reflections for iKi, a local AI companion with a structured life runtime.',
  'Summarize only what the persisted episode trajectory supports.',
  'Focus on semantic activity, commitments, state drift, and what should matter next.',
  'Do not invent embodiment, fake emotions, or physical experiences.',
  'Output strict JSON only with this exact shape:',
  '{"summary":"string","insights":["string"],"next_focus":["string"],"memory_candidate":"string|null","memory_confidence":"none|low|medium|high"}',
  'Use memory_candidate only for durable, future-useful facts or patterns. Otherwise set it to null and confidence to "none".',
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

const parseJsonStringArray = (value: string | null | undefined): string[] => {
  if (!value?.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry): entry is string => typeof entry === 'string')
      .map(entry => clipText(entry, MAX_LIST_ITEM_CHARS))
      .filter(Boolean);
  } catch {
    return [];
  }
};

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

const formatEpisodeLine = (episode: LifeEpisodeRecord): string => {
  const startedAt = new Date(episode.started_at);
  const endedAt = episode.ended_at ? new Date(episode.ended_at) : null;
  const startedText = Number.isNaN(startedAt.getTime())
    ? episode.started_at
    : startedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const endedText =
    endedAt && !Number.isNaN(endedAt.getTime())
      ? endedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : episode.ended_at || 'open';
  const refs = [
    episode.task_id ? `task=${episode.task_id}` : '',
    episode.thread_id ? `thread=${episode.thread_id}` : '',
    episode.trigger_type ? `trigger=${episode.trigger_type}` : '',
  ]
    .filter(Boolean)
    .join(', ');

  return [
    `${startedText} -> ${endedText}`,
    `${episode.activity_type} / ${episode.presence}`,
    clipText(episode.summary || episode.transition_reason, 180),
    refs ? `[${refs}]` : '',
  ]
    .filter(Boolean)
    .join(' | ');
};

const buildEpisodesTranscript = (episodes: LifeEpisodeRecord[]): string => {
  const lines = episodes.slice(0, MAX_EPISODE_LINES).map(formatEpisodeLine);
  return clipText(lines.join('\n'), MAX_PROMPT_CHARS);
};

const isMeaningfulHourlyWindow = (episodes: LifeEpisodeRecord[]): boolean => {
  if (episodes.length === 0) return false;
  if (episodes.length > 1) return true;
  return episodes.some(
    episode => episode.activity_type !== 'companion_idle' || Boolean(episode.task_id || episode.thread_id)
  );
};

const buildReflectionPrompt = (params: {
  episodes: LifeEpisodeRecord[];
  periodStart: string;
  periodEnd: string;
  profileName: string;
  ownerName: string;
}): string => {
  const sections = [
    `Profile: ${params.profileName}`,
    `Owner label: ${params.ownerName || 'the user'}`,
    `Reflection window (ISO): ${params.periodStart} -> ${params.periodEnd}`,
    `Episode trajectory:\n${buildEpisodesTranscript(params.episodes)}`,
    [
      'Write an hourly reflection from this trajectory.',
      'Prefer compact factual language.',
      'Capture the dominant arc, 1-4 insights, and 0-3 next-focus items.',
      'Only propose a memory_candidate when the hour revealed something durable enough to remember later.',
    ].join('\n'),
  ];
  return sections.join('\n\n');
};

const resolveSingleThreadForMemoryWriteback = (episodes: LifeEpisodeRecord[]): string | null => {
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
  episodes: LifeEpisodeRecord[];
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

const writeReflectionMemory = (params: {
  reflectionRecord: LifeReflectionRecord;
  reflection: ReflectionModelOutput;
  episodes: LifeEpisodeRecord[];
  model: ToolModelConfig;
}): boolean => {
  const target = shouldWriteReflectionMemory({
    reflection: params.reflection,
    episodes: params.episodes,
  });
  if (!target) return false;

  const result = memoryDb.addLongMemory({
    thread_id: target.threadId,
    summary: target.summary,
    tags: MEMORY_TAGS,
    metadata: {
      source: 'life-reflection',
      reflectionId: params.reflectionRecord.id,
      periodType: params.reflectionRecord.period_type,
      periodStart: params.reflectionRecord.period_start,
      model: params.model,
    },
  });
  return Boolean(result);
};

const generateReflectionForWindow = async (params: {
  profileId: string;
  profileName: string;
  ownerName: string;
  periodStart: string;
  periodEnd: string;
  episodes: LifeEpisodeRecord[];
  toolModel: ToolModelConfig;
}): Promise<GeneratedLifeReflection | null> => {
  const prompt = buildReflectionPrompt({
    episodes: params.episodes,
    periodStart: params.periodStart,
    periodEnd: params.periodEnd,
    profileName: params.profileName,
    ownerName: params.ownerName,
  });
  if (!prompt.trim()) return null;

  const generator = createSimplePromptTextGenerator({
    enabled: true,
    providerType: params.toolModel.providerType,
    model: params.toolModel.model,
    systemPrompt: SYSTEM_PROMPT,
    temperature: 0.15,
    maxTokens: 420,
    maxIterations: 1,
    enableTools: false,
    enableMemory: false,
  });

  try {
    const result = await generator.generate(prompt);
    const reflection = parseReflectionModelOutput(result.response || '');
    if (!reflection) return null;

    const record = lifeReflectionDb.addLifeReflection({
      profile_id: params.profileId,
      period_type: HOURLY_PERIOD_TYPE,
      period_start: params.periodStart,
      period_end: params.periodEnd,
      summary: reflection.summary,
      insights_json: JSON.stringify(reflection.insights),
      plan_json: JSON.stringify(reflection.next_focus),
    });

    const wroteMemory = writeReflectionMemory({
      reflectionRecord: record,
      reflection,
      episodes: params.episodes,
      model: params.toolModel,
    });

    return {
      record,
      wroteMemory,
    };
  } catch (error) {
    console.warn('[Life] hourly reflection generation failed:', error);
    return null;
  }
};

const reflectionLocks = new Set<string>();

export const runDueHourlyLifeReflections = async (params?: {
  now?: string;
  maxWindows?: number;
}): Promise<GeneratedLifeReflection[]> => {
  const profile = getOrCreateActiveIdentityProfile();
  if (!profile) return [];

  const toolModel = getToolModel();
  if (!toolModel) return [];

  const now = params?.now ? new Date(params.now) : new Date();
  if (Number.isNaN(now.getTime())) return [];

  const windows = buildHourlyWindows(now, params?.maxWindows);
  const results: GeneratedLifeReflection[] = [];

  for (const window of windows) {
    const periodStart = window.start.toISOString();
    const periodEnd = window.end.toISOString();
    const lockKey = `${profile.id}:${HOURLY_PERIOD_TYPE}:${periodStart}`;

    if (reflectionLocks.has(lockKey)) continue;
    if (lifeReflectionDb.getLifeReflection(profile.id, HOURLY_PERIOD_TYPE, periodStart)) continue;

    const episodes = lifeDb.listLifeEpisodesInWindow(profile.id, periodStart, periodEnd);
    if (!isMeaningfulHourlyWindow(episodes)) continue;

    reflectionLocks.add(lockKey);
    try {
      const generated = await generateReflectionForWindow({
        profileId: profile.id,
        profileName: profile.name,
        ownerName: profile.owner_name,
        periodStart,
        periodEnd,
        episodes,
        toolModel,
      });
      if (generated) {
        results.push(generated);
      }
    } finally {
      reflectionLocks.delete(lockKey);
    }
  }

  return results;
};

export const getRecentLifeReflectionContextMessage = (): string => {
  const profile = getOrCreateActiveIdentityProfile();
  if (!profile) return '';

  const reflection = lifeReflectionDb.getLatestLifeReflection(profile.id, HOURLY_PERIOD_TYPE);
  if (!reflection) return '';

  const insights = parseJsonStringArray(reflection.insights_json).slice(0, 2);
  const plan = parseJsonStringArray(reflection.plan_json).slice(0, 2);

  return [
    'Recent life reflection for iKi:',
    `- Hourly recap: ${clipText(reflection.summary, MAX_SUMMARY_CHARS)}`,
    ...(insights.length > 0 ? ['- Insights:', ...insights.map(item => `  - ${item}`)] : []),
    ...(plan.length > 0 ? ['- Next focus:', ...plan.map(item => `  - ${item}`)] : []),
  ].join('\n');
};
