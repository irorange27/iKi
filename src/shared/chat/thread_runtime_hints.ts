import { isObjectRecord, type ObjectRecord } from '../utils/guards';
import {
  isAffectLabel,
  type AffectScore,
  type AffectSignal,
  type AffectSignalSource,
} from '../emotion/affect';

export type ThreadToolSelectionMode = 'manual' | 'auto';

export type ThreadToolSelectionState = {
  mode?: ThreadToolSelectionMode;
  mcpServerIds: string[];
};

export type ThreadAffectState = AffectSignal & {
  updatedAt?: string;
};

export const normalizeStringArray = (input: unknown): string[] => {
  if (!Array.isArray(input)) return [];

  const resolved: string[] = [];
  const seen = new Set<string>();

  for (const item of input) {
    if (typeof item !== 'string') continue;
    const trimmed = item.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    resolved.push(trimmed);
  }

  return resolved;
};

export const parseJsonRecord = (raw: unknown): ObjectRecord => {
  if (isObjectRecord(raw)) return raw;
  if (typeof raw !== 'string' || !raw.trim()) return {};

  try {
    const parsed = JSON.parse(raw);
    return isObjectRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

export const parseThreadToolNames = (raw: unknown): string[] => {
  if (typeof raw === 'string') {
    try {
      return normalizeStringArray(JSON.parse(raw));
    } catch {
      return [];
    }
  }

  return normalizeStringArray(raw);
};

export const parseThreadToolSelectionState = (metadataRaw: unknown): ThreadToolSelectionState => {
  const metadata = parseJsonRecord(metadataRaw);
  const toolSelection = isObjectRecord(metadata.toolSelection) ? metadata.toolSelection : {};
  const mode =
    toolSelection.mode === 'auto' || toolSelection.mode === 'manual'
      ? toolSelection.mode
      : undefined;

  return {
    mode,
    mcpServerIds: normalizeStringArray(toolSelection.mcpServerIds),
  };
};

const toFiniteNumber = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
};

const normalizeAffectScores = (value: unknown): AffectScore[] => {
  if (!Array.isArray(value)) return [];

  return value
    .map(entry => {
      if (!isObjectRecord(entry) || !isAffectLabel(entry.label)) return null;
      const score = toFiniteNumber(entry.score);
      if (score === undefined) return null;
      return {
        label: entry.label,
        score: Math.min(1, Math.max(0, score)),
      };
    })
    .filter((entry): entry is AffectScore => entry !== null)
    .slice(0, 3);
};

export const parseThreadAffectState = (metadataRaw: unknown): ThreadAffectState | null => {
  const metadata = parseJsonRecord(metadataRaw);
  const affect = isObjectRecord(metadata.affect) ? metadata.affect : null;
  const state = affect && isObjectRecord(affect.state) ? affect.state : null;
  if (!affect || !state || !isAffectLabel(state.label)) return null;

  const confidence = toFiniteNumber(state.confidence);
  if (confidence === undefined) return null;

  const source: AffectSignalSource =
    affect.source === 'realtime' || affect.source === 'history' ? affect.source : 'history';

  return {
    source,
    guardActive: affect.guardActive === true,
    state: {
      label: state.label,
      confidence: Math.min(1, Math.max(0, confidence)),
      ...(toFiniteNumber(state.valence) !== undefined
        ? { valence: Math.min(1, Math.max(-1, toFiniteNumber(state.valence) as number)) }
        : {}),
      ...(toFiniteNumber(state.arousal) !== undefined
        ? { arousal: Math.min(1, Math.max(0, toFiniteNumber(state.arousal) as number)) }
        : {}),
      ...(normalizeAffectScores(state.emotions).length > 0
        ? { emotions: normalizeAffectScores(state.emotions) }
        : {}),
      sampleCount: Math.max(0, Math.trunc(toFiniteNumber(state.sampleCount) ?? 0)),
      windowSize: Math.max(0, Math.trunc(toFiniteNumber(state.windowSize) ?? 0)),
      startAt: typeof state.startAt === 'string' ? state.startAt : '',
      endAt: typeof state.endAt === 'string' ? state.endAt : '',
      ageMinutes: Math.max(0, toFiniteNumber(state.ageMinutes) ?? 0),
      windowMinutes: Math.max(0, toFiniteNumber(state.windowMinutes) ?? 0),
    },
    ...(typeof affect.updatedAt === 'string' && affect.updatedAt.trim()
      ? { updatedAt: affect.updatedAt }
      : {}),
  };
};

export const buildThreadRuntimeMetadata = (params: {
  existingMetadata: unknown;
  providerType: string;
  model: string;
  toolMode: ThreadToolSelectionMode;
  mcpServerIds?: string[];
  affectSignal?: AffectSignal | null;
  updatedAt?: string;
}): ObjectRecord => {
  const metadataRecord = parseJsonRecord(params.existingMetadata);
  const nextLlm = isObjectRecord(metadataRecord.llm) ? metadataRecord.llm : {};
  const nextToolSelection = isObjectRecord(metadataRecord.toolSelection)
    ? metadataRecord.toolSelection
    : {};
  const updatedAt = params.updatedAt || new Date().toISOString();
  const nextMetadata: ObjectRecord = {
    ...metadataRecord,
    llm: {
      ...nextLlm,
      providerType: params.providerType,
      model: params.model,
      updatedAt,
    },
    toolSelection: {
      ...nextToolSelection,
      mode: params.toolMode,
      mcpServerIds: normalizeStringArray(params.mcpServerIds),
      updatedAt,
    },
  };

  if (Object.prototype.hasOwnProperty.call(params, 'affectSignal')) {
    if (params.affectSignal) {
      nextMetadata.affect = {
        source: params.affectSignal.source,
        guardActive: params.affectSignal.guardActive,
        updatedAt,
        state: {
          label: params.affectSignal.state.label,
          confidence: params.affectSignal.state.confidence,
          ...(typeof params.affectSignal.state.valence === 'number'
            ? { valence: params.affectSignal.state.valence }
            : {}),
          ...(typeof params.affectSignal.state.arousal === 'number'
            ? { arousal: params.affectSignal.state.arousal }
            : {}),
          ...(Array.isArray(params.affectSignal.state.emotions) &&
          params.affectSignal.state.emotions.length > 0
            ? { emotions: params.affectSignal.state.emotions }
            : {}),
          sampleCount: params.affectSignal.state.sampleCount,
          windowSize: params.affectSignal.state.windowSize,
          startAt: params.affectSignal.state.startAt,
          endAt: params.affectSignal.state.endAt,
          ageMinutes: params.affectSignal.state.ageMinutes,
          windowMinutes: params.affectSignal.state.windowMinutes,
        },
      };
    } else {
      delete nextMetadata.affect;
    }
  }

  return nextMetadata;
};
