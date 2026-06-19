import {
  createAffectSignalPart,
  createMemoryPart,
  createSkillUsagePart,
  createTokenUsagePart,
  isAffectSignalPart,
  isMemoryPart,
  isObjectRecord,
  isSkillUsagePart,
  isTokenUsagePart,
  type AffectSignalPart,
  type SkillUsageEntry,
  type UiMessagePart,
} from '@iki/backend/chat/message_parts';
import { isAffectLabel, type AffectLabel } from '@iki/core/types/affect';
import { updateAssistantMessage } from './ui_stream_reducer_message';
import type {
  ReduceResult,
  StreamAction,
  StreamContext,
  StreamState,
} from './ui_stream_reducer_types';

const replaceOrPrependPart = (
  parts: UiMessagePart[],
  nextPart: UiMessagePart,
  matcher: (part: UiMessagePart) => boolean
): UiMessagePart[] => {
  const nextParts = [...parts];
  const existingIndex = nextParts.findIndex(matcher);

  if (existingIndex >= 0) {
    nextParts[existingIndex] = nextPart;
  } else {
    nextParts.unshift(nextPart);
  }

  return nextParts;
};

export const reduceMemoryChunkAction = (
  state: StreamState,
  ctx: StreamContext,
  action: Extract<StreamAction, { type: 'memory_chunk' }>
): ReduceResult => {
  const results = Array.isArray(action.chunk.results)
    ? action.chunk.results.filter(entry => isObjectRecord(entry) && typeof entry.summary === 'string')
    : [];

  const updateResult = updateAssistantMessage(state, ctx, message => ({
    ...message,
    parts: replaceOrPrependPart(
      message.parts,
      createMemoryPart({
        query: typeof action.chunk.query === 'string' ? action.chunk.query : '',
        results,
      }),
      isMemoryPart
    ),
  }));

  return {
    state: updateResult.state,
    messageOps: updateResult.messageOps,
    effects: [{ type: 'scroll' }],
  };
};

export const reduceSkillChunkAction = (
  state: StreamState,
  ctx: StreamContext,
  action: Extract<StreamAction, { type: 'skill_chunk' }>
): ReduceResult => {
  const skills = Array.isArray(action.chunk.skills)
    ? action.chunk.skills
        .filter(
          (entry): entry is SkillUsageEntry =>
            isObjectRecord(entry) &&
            typeof entry.id === 'string' &&
            entry.id.trim().length > 0 &&
            typeof entry.name === 'string' &&
            entry.name.trim().length > 0
        )
        .map(entry => ({
          id: entry.id.trim(),
          name: entry.name.trim(),
          ...(typeof entry.description === 'string' && entry.description.trim()
            ? { description: entry.description.trim() }
            : {}),
          ...(entry.source === 'user' || entry.source === 'codex'
            ? { source: entry.source }
            : {}),
        }))
    : [];

  if (skills.length === 0) {
    return { state, messageOps: [], effects: [] };
  }

  const updateResult = updateAssistantMessage(state, ctx, message => ({
    ...message,
    parts: replaceOrPrependPart(
      message.parts,
      createSkillUsagePart({
        mode: action.chunk.mode === 'auto' ? 'auto' : 'manual',
        skills,
      }),
      isSkillUsagePart
    ),
  }));

  return {
    state: updateResult.state,
    messageOps: updateResult.messageOps,
    effects: [{ type: 'scroll' }],
  };
};

const buildAffectPart = (
  action: Extract<StreamAction, { type: 'affect_chunk' }>,
  label: AffectLabel,
  emotions: Array<{ label: AffectLabel; score: number }>
): AffectSignalPart =>
  createAffectSignalPart({
    label,
    ...(action.chunk.source === 'history' || action.chunk.source === 'realtime'
      ? { source: action.chunk.source }
      : {}),
    ...(typeof action.chunk.guardActive === 'boolean'
      ? { guardActive: action.chunk.guardActive }
      : {}),
    ...(typeof action.chunk.confidence === 'number' && Number.isFinite(action.chunk.confidence)
      ? { confidence: Math.min(1, Math.max(0, action.chunk.confidence)) }
      : {}),
    ...(typeof action.chunk.valence === 'number' && Number.isFinite(action.chunk.valence)
      ? { valence: Math.min(1, Math.max(-1, action.chunk.valence)) }
      : {}),
    ...(typeof action.chunk.arousal === 'number' && Number.isFinite(action.chunk.arousal)
      ? { arousal: Math.min(1, Math.max(0, action.chunk.arousal)) }
      : {}),
    ...(emotions.length > 0 ? { emotions } : {}),
    ...(typeof action.chunk.sampleCount === 'number' && Number.isFinite(action.chunk.sampleCount)
      ? { sampleCount: Math.max(0, Math.trunc(action.chunk.sampleCount)) }
      : {}),
    ...(typeof action.chunk.windowSize === 'number' && Number.isFinite(action.chunk.windowSize)
      ? { windowSize: Math.max(0, Math.trunc(action.chunk.windowSize)) }
      : {}),
    ...(typeof action.chunk.startAt === 'string' ? { startAt: action.chunk.startAt } : {}),
    ...(typeof action.chunk.endAt === 'string' ? { endAt: action.chunk.endAt } : {}),
    ...(typeof action.chunk.ageMinutes === 'number' && Number.isFinite(action.chunk.ageMinutes)
      ? { ageMinutes: Math.max(0, action.chunk.ageMinutes) }
      : {}),
    ...(typeof action.chunk.windowMinutes === 'number' && Number.isFinite(action.chunk.windowMinutes)
      ? { windowMinutes: Math.max(0, action.chunk.windowMinutes) }
      : {}),
  });

export const reduceAffectChunkAction = (
  state: StreamState,
  ctx: StreamContext,
  action: Extract<StreamAction, { type: 'affect_chunk' }>
): ReduceResult => {
  if (!isAffectLabel(action.chunk.label)) {
    return { state, messageOps: [], effects: [] };
  }
  const label = action.chunk.label;

  const emotions = Array.isArray(action.chunk.emotions)
    ? action.chunk.emotions
        .filter(
          (entry): entry is { label: AffectLabel; score: number } =>
            isObjectRecord(entry) &&
            isAffectLabel(entry.label) &&
            typeof entry.score === 'number' &&
            Number.isFinite(entry.score)
        )
        .map(entry => ({
          label: entry.label,
          score: Math.min(1, Math.max(0, entry.score)),
        }))
    : [];

  const updateResult = updateAssistantMessage(state, ctx, message => ({
    ...message,
    parts: replaceOrPrependPart(
      message.parts,
      buildAffectPart(action, label, emotions),
      isAffectSignalPart
    ),
  }));

  return {
    state: updateResult.state,
    messageOps: updateResult.messageOps,
    effects: [{ type: 'scroll' }],
  };
};

const toInteger = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : undefined;

const toCost = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : undefined;

export const reduceUsageChunkAction = (
  state: StreamState,
  ctx: StreamContext,
  action: Extract<StreamAction, { type: 'usage_chunk' }>
): ReduceResult => {
  const inputTokens = toInteger(action.chunk.inputTokens);
  const outputTokens = toInteger(action.chunk.outputTokens);
  const totalTokens = toInteger(action.chunk.totalTokens);
  const cacheReadTokens = toInteger(action.chunk.cacheReadTokens);
  const cacheWriteTokens = toInteger(action.chunk.cacheWriteTokens);
  const reasoningTokens = toInteger(action.chunk.reasoningTokens);
  const estimatedCostUsd = toCost(action.chunk.estimatedCostUsd);
  const maxInputTokens = toInteger(action.chunk.maxInputTokens);
  const maxOutputTokens = toInteger(action.chunk.maxOutputTokens);
  const usagePart = createTokenUsagePart({
    ...(inputTokens !== undefined ? { inputTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
    ...(totalTokens !== undefined ? { totalTokens } : {}),
    ...(cacheReadTokens !== undefined ? { cacheReadTokens } : {}),
    ...(cacheWriteTokens !== undefined ? { cacheWriteTokens } : {}),
    ...(reasoningTokens !== undefined ? { reasoningTokens } : {}),
    ...(estimatedCostUsd !== undefined ? { estimatedCostUsd } : {}),
    ...(maxInputTokens !== undefined ? { maxInputTokens } : {}),
    ...(maxOutputTokens !== undefined ? { maxOutputTokens } : {}),
    ...(typeof action.chunk.model === 'string' && action.chunk.model.trim()
      ? { model: action.chunk.model.trim() }
      : {}),
    ...(typeof action.chunk.providerType === 'string' && action.chunk.providerType.trim()
      ? { providerType: action.chunk.providerType.trim() }
      : {}),
    ...(typeof action.chunk.providerId === 'string' && action.chunk.providerId.trim()
      ? { providerId: action.chunk.providerId.trim() }
      : {}),
  });

  const updateResult = updateAssistantMessage(state, ctx, message => ({
    ...message,
    parts: replaceOrPrependPart(message.parts, usagePart, isTokenUsagePart),
  }));

  return {
    state: updateResult.state,
    messageOps: updateResult.messageOps,
    effects: [{ type: 'scroll' }],
  };
};
