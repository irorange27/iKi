import { isObjectRecord, type ObjectRecord } from '../utils/guards';

export type ThreadToolSelectionMode = 'manual' | 'auto';

export type ThreadToolSelectionState = {
  mode?: ThreadToolSelectionMode;
  mcpServerIds: string[];
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

export const buildThreadRuntimeMetadata = (params: {
  existingMetadata: unknown;
  providerType: string;
  model: string;
  toolMode: ThreadToolSelectionMode;
  mcpServerIds?: string[];
  updatedAt?: string;
}): ObjectRecord => {
  const metadataRecord = parseJsonRecord(params.existingMetadata);
  const nextLlm = isObjectRecord(metadataRecord.llm) ? metadataRecord.llm : {};
  const nextToolSelection = isObjectRecord(metadataRecord.toolSelection)
    ? metadataRecord.toolSelection
    : {};
  const updatedAt = params.updatedAt || new Date().toISOString();

  return {
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
};
