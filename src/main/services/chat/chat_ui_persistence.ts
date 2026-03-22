import type { ContextReportItem, SkillUsageEntry } from '../../../shared/chat/message_parts';
import { isAffectLabel } from '../../../shared/emotion/affect';
import { isObjectRecord, normalizeDynamicToolPart } from '../../../shared/chat/tool_parts';

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
          const normalized = normalizeDynamicToolPart(part, createRuntimeId('tool_call'));

          // Keep only semantically meaningful fields; drop renderer-only UI state.
          delete normalized.callProviderMetadata;

          nextParts.push(normalized);
          continue;
        }

        if (part.type === 'memory-retrieval') {
          const normalized: Record<string, unknown> = {
            type: 'memory-retrieval',
          };
          if (typeof part.query === 'string' && part.query.trim()) {
            normalized.query = part.query.trim();
          }
          if (Array.isArray(part.results)) {
            normalized.results = part.results.filter(
              entry => entry && typeof entry === 'object' && 'summary' in entry
            );
          } else {
            normalized.results = [];
          }
          nextParts.push(normalized);
          continue;
        }

        if (part.type === 'skill-usage') {
          const normalized: Record<string, unknown> = {
            type: 'skill-usage',
          };
          if (part.mode === 'manual' || part.mode === 'auto') {
            normalized.mode = part.mode;
          }
          if (Array.isArray(part.skills)) {
            normalized.skills = part.skills
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
            normalized.skills = [];
          }
          nextParts.push(normalized);
          continue;
        }

        if (part.type === 'affect-signal') {
          const normalized: Record<string, unknown> = {
            type: 'affect-signal',
          };
          if (part.source === 'history' || part.source === 'realtime') {
            normalized.source = part.source;
          }
          if (typeof part.guardActive === 'boolean') {
            normalized.guardActive = part.guardActive;
          }
          if (isAffectLabel(part.label)) {
            normalized.label = part.label;
          }
          if (typeof part.confidence === 'number' && Number.isFinite(part.confidence)) {
            normalized.confidence = Math.min(1, Math.max(0, part.confidence));
          }
          if (typeof part.valence === 'number' && Number.isFinite(part.valence)) {
            normalized.valence = Math.min(1, Math.max(-1, part.valence));
          }
          if (typeof part.arousal === 'number' && Number.isFinite(part.arousal)) {
            normalized.arousal = Math.min(1, Math.max(0, part.arousal));
          }
          if (Array.isArray(part.emotions)) {
            normalized.emotions = part.emotions
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
            normalized.emotions = [];
          }
          if (typeof part.sampleCount === 'number' && Number.isFinite(part.sampleCount)) {
            normalized.sampleCount = Math.max(0, Math.trunc(part.sampleCount));
          }
          if (typeof part.windowSize === 'number' && Number.isFinite(part.windowSize)) {
            normalized.windowSize = Math.max(0, Math.trunc(part.windowSize));
          }
          if (typeof part.startAt === 'string' && part.startAt.trim()) {
            normalized.startAt = part.startAt.trim();
          }
          if (typeof part.endAt === 'string' && part.endAt.trim()) {
            normalized.endAt = part.endAt.trim();
          }
          if (typeof part.ageMinutes === 'number' && Number.isFinite(part.ageMinutes)) {
            normalized.ageMinutes = Math.max(0, part.ageMinutes);
          }
          if (typeof part.windowMinutes === 'number' && Number.isFinite(part.windowMinutes)) {
            normalized.windowMinutes = Math.max(0, part.windowMinutes);
          }
          nextParts.push(normalized);
          continue;
        }

        if (part.type === 'context-report') {
          const normalized: Record<string, unknown> = {
            type: 'context-report',
          };
          if (
            typeof part.totalEstimatedTokens === 'number' &&
            Number.isFinite(part.totalEstimatedTokens)
          ) {
            normalized.totalEstimatedTokens = Math.max(0, Math.trunc(part.totalEstimatedTokens));
          }
          if (
            typeof part.retainedRecentMessages === 'number' &&
            Number.isFinite(part.retainedRecentMessages)
          ) {
            normalized.retainedRecentMessages = Math.max(
              0,
              Math.trunc(part.retainedRecentMessages)
            );
          }
          if (
            typeof part.compactedMessages === 'number' &&
            Number.isFinite(part.compactedMessages)
          ) {
            normalized.compactedMessages = Math.max(0, Math.trunc(part.compactedMessages));
          }
          if (Array.isArray(part.blocks)) {
            normalized.blocks = part.blocks
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
            normalized.blocks = [];
          }
          nextParts.push(normalized);
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
