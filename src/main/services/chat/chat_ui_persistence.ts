import {
  type AffectSignalPartData,
  type ContextReportItem,
  type ContextReportPartData,
  type MemoryPartData,
  type SkillUsageEntry,
  type SkillUsagePartData,
  createAffectSignalPart,
  createContextReportPart,
  createMemoryPart,
  createSkillUsagePart,
  normalizeChatUiMetadataPart,
} from '../../../shared/chat/message_parts';
import { isAffectLabel } from '../../../shared/emotion/affect';
import { isObjectRecord, normalizeToolPartForValidation } from '../../../shared/chat/tool_parts';

import { createRuntimeId } from './chat_ui_tool_parts';

export { parseStoredUiMessageRow } from '../../../shared/chat/ui_message_codec';

export const sanitizeUiMessageJsonForStorage = (raw: string): string => {
  if (typeof raw !== 'string') return String(raw);
  const trimmed = raw.trim();
  if (!trimmed) return raw;

  try {
    const parsed = JSON.parse(trimmed);
    if (!isObjectRecord(parsed)) return raw;

    const role =
      parsed.role === 'system' || parsed.role === 'assistant' || parsed.role === 'user'
        ? parsed.role
        : 'user';

    const sanitized: Record<string, unknown> = { role };
    const parts = Array.isArray(parsed.parts) ? parsed.parts : null;

    if (parts) {
      const nextParts: Array<Record<string, unknown>> = [];
      for (const part of parts) {
        if (!isObjectRecord(part) || typeof part.type !== 'string') continue;

        if (part.type === 'text') {
          if (typeof part.text !== 'string') continue;
          nextParts.push({ type: 'text', text: part.text });
          continue;
        }

        if (part.type === 'dynamic-tool') {
          const normalized = normalizeToolPartForValidation(part, createRuntimeId('tool_call'));
          if (!normalized) continue;

          nextParts.push(normalized);
          continue;
        }

        const normalizedMetadataPart = normalizeChatUiMetadataPart(part);
        if (normalizedMetadataPart) {
          switch (normalizedMetadataPart.type) {
            case 'data-memory-retrieval': {
              const memoryData = normalizedMetadataPart.data;
              const normalizedData: MemoryPartData = {};
              if (typeof memoryData.query === 'string' && memoryData.query.trim()) {
                normalizedData.query = memoryData.query.trim();
              }
              if (Array.isArray(memoryData.results)) {
                normalizedData.results = memoryData.results.filter(
                  entry => entry && typeof entry === 'object' && 'summary' in entry
                );
              } else {
                normalizedData.results = [];
              }
              nextParts.push(createMemoryPart(normalizedData));
              continue;
            }
            case 'data-skill-usage': {
              const skillData = normalizedMetadataPart.data;
              const normalizedData: SkillUsagePartData = {};
              if (skillData.mode === 'manual' || skillData.mode === 'auto') {
                normalizedData.mode = skillData.mode;
              }
              if (Array.isArray(skillData.skills)) {
                normalizedData.skills = skillData.skills
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
                  }));
              } else {
                normalizedData.skills = [];
              }
              nextParts.push(createSkillUsagePart(normalizedData));
              continue;
            }
            case 'data-affect-signal': {
              const affectData = normalizedMetadataPart.data;
              const normalizedData: AffectSignalPartData = {};
              if (affectData.source === 'history' || affectData.source === 'realtime') {
                normalizedData.source = affectData.source;
              }
              if (typeof affectData.guardActive === 'boolean') {
                normalizedData.guardActive = affectData.guardActive;
              }
              if (isAffectLabel(affectData.label)) {
                normalizedData.label = affectData.label;
              }
              if (
                typeof affectData.confidence === 'number' &&
                Number.isFinite(affectData.confidence)
              ) {
                normalizedData.confidence = Math.min(1, Math.max(0, affectData.confidence));
              }
              if (typeof affectData.valence === 'number' && Number.isFinite(affectData.valence)) {
                normalizedData.valence = Math.min(1, Math.max(-1, affectData.valence));
              }
              if (typeof affectData.arousal === 'number' && Number.isFinite(affectData.arousal)) {
                normalizedData.arousal = Math.min(1, Math.max(0, affectData.arousal));
              }
              if (Array.isArray(affectData.emotions)) {
                normalizedData.emotions = affectData.emotions
                  .filter(
                    entry =>
                      isObjectRecord(entry) &&
                      isAffectLabel(entry.label) &&
                      typeof entry.score === 'number' &&
                      Number.isFinite(entry.score)
                  )
                  .map(entry => ({
                    label: entry.label,
                    score: Math.min(1, Math.max(0, entry.score)),
                  }));
              } else {
                normalizedData.emotions = [];
              }
              if (
                typeof affectData.sampleCount === 'number' &&
                Number.isFinite(affectData.sampleCount)
              ) {
                normalizedData.sampleCount = Math.max(0, Math.trunc(affectData.sampleCount));
              }
              if (
                typeof affectData.windowSize === 'number' &&
                Number.isFinite(affectData.windowSize)
              ) {
                normalizedData.windowSize = Math.max(0, Math.trunc(affectData.windowSize));
              }
              if (typeof affectData.startAt === 'string' && affectData.startAt.trim()) {
                normalizedData.startAt = affectData.startAt.trim();
              }
              if (typeof affectData.endAt === 'string' && affectData.endAt.trim()) {
                normalizedData.endAt = affectData.endAt.trim();
              }
              if (
                typeof affectData.ageMinutes === 'number' &&
                Number.isFinite(affectData.ageMinutes)
              ) {
                normalizedData.ageMinutes = Math.max(0, affectData.ageMinutes);
              }
              if (
                typeof affectData.windowMinutes === 'number' &&
                Number.isFinite(affectData.windowMinutes)
              ) {
                normalizedData.windowMinutes = Math.max(0, affectData.windowMinutes);
              }
              nextParts.push(createAffectSignalPart(normalizedData));
              continue;
            }
            case 'data-context-report': {
              const contextData = normalizedMetadataPart.data;
              const normalizedData: ContextReportPartData = {};
              if (
                typeof contextData.totalEstimatedTokens === 'number' &&
                Number.isFinite(contextData.totalEstimatedTokens)
              ) {
                normalizedData.totalEstimatedTokens = Math.max(
                  0,
                  Math.trunc(contextData.totalEstimatedTokens)
                );
              }
              if (
                typeof contextData.retainedRecentMessages === 'number' &&
                Number.isFinite(contextData.retainedRecentMessages)
              ) {
                normalizedData.retainedRecentMessages = Math.max(
                  0,
                  Math.trunc(contextData.retainedRecentMessages)
                );
              }
              if (
                typeof contextData.compactedMessages === 'number' &&
                Number.isFinite(contextData.compactedMessages)
              ) {
                normalizedData.compactedMessages = Math.max(
                  0,
                  Math.trunc(contextData.compactedMessages)
                );
              }
              if (Array.isArray(contextData.blocks)) {
                normalizedData.blocks = contextData.blocks
                  .filter(
                    (entry): entry is ContextReportItem =>
                      isObjectRecord(entry) &&
                      typeof entry.kind === 'string' &&
                      typeof entry.status === 'string'
                  )
                  .map(entry => ({
                    kind: entry.kind,
                    status: entry.status,
                    ...(typeof entry.estimatedTokens === 'number' &&
                    Number.isFinite(entry.estimatedTokens)
                      ? { estimatedTokens: Math.max(0, Math.trunc(entry.estimatedTokens)) }
                      : {}),
                    ...(typeof entry.charCount === 'number' && Number.isFinite(entry.charCount)
                      ? { charCount: Math.max(0, Math.trunc(entry.charCount)) }
                      : {}),
                    ...(typeof entry.reason === 'string' && entry.reason.trim()
                      ? { reason: entry.reason.trim() }
                      : {}),
                    ...(typeof entry.sourceCount === 'number' && Number.isFinite(entry.sourceCount)
                      ? { sourceCount: Math.max(0, Math.trunc(entry.sourceCount)) }
                      : {}),
                  }));
              } else {
                normalizedData.blocks = [];
              }
              nextParts.push(createContextReportPart(normalizedData));
              continue;
            }
          }
        }
      }

      sanitized.parts = nextParts;
    } else if (typeof parsed.content === 'string') {
      sanitized.parts = [{ type: 'text', text: parsed.content }];
    }

    return JSON.stringify(sanitized);
  } catch {
    return raw;
  }
};
