import { isObjectRecord, type ObjectRecord } from '@iki/backend/utils/guards';

export type ThreadLlmSelectionState = {
  providerType?: string;
  providerId?: string;
  model?: string;
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

export const parseThreadLlmSelectionState = (metadataRaw: unknown): ThreadLlmSelectionState => {
  const metadata = parseJsonRecord(metadataRaw);
  const llm = isObjectRecord(metadata.llm) ? metadata.llm : {};
  const providerType =
    typeof llm.providerType === 'string' && llm.providerType.trim().length > 0
      ? llm.providerType.trim()
      : undefined;
  const providerId =
    typeof llm.providerId === 'string' && llm.providerId.trim().length > 0
      ? llm.providerId.trim()
      : undefined;
  const model =
    typeof llm.model === 'string' && llm.model.trim().length > 0 ? llm.model.trim() : undefined;

  return {
    ...(providerType ? { providerType } : {}),
    ...(providerId ? { providerId } : {}),
    ...(model ? { model } : {}),
  };
};

export const buildThreadRuntimeMetadata = (params: {
  existingMetadata: unknown;
  providerType: string;
  providerId?: string;
  model: string;
  updatedAt?: string;
}): ObjectRecord => {
  const metadataRecord = parseJsonRecord(params.existingMetadata);
  const nextLlm = isObjectRecord(metadataRecord.llm) ? metadataRecord.llm : {};
  const updatedAt = params.updatedAt || new Date().toISOString();
  const nextMetadata: ObjectRecord = {
    ...metadataRecord,
    llm: {
      ...nextLlm,
      providerType: params.providerType,
      ...(typeof params.providerId === 'string' && params.providerId.trim().length > 0
        ? { providerId: params.providerId.trim() }
        : {}),
      model: params.model,
      updatedAt,
    },
  };

  return nextMetadata;
};
