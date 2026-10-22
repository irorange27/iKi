import { createLogger } from '@iki/backend/logger';
import type { ToolModelConfig } from '../provider/tool_model';
import { generatePromptText } from './prompt_text_generator';
import { normalizeWhitespace } from '@iki/backend/utils/text';

export type SelectionMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

export type CatalogSelectionRequest<T> = {
  messages: SelectionMessage[];
  availableCatalog: T[];
  buildCatalogText: (items: T[]) => string;
  buildPrompt: (catalogText: string, transcript: string) => string;
  parseSelection: (raw: string, items: T[]) => string[];
  systemPrompt: string;
  maxMessages: number;
  maxInputChars: number;
  maxOutputTokens: number;
  logLabel: string;
};

const formatRole = (role: SelectionMessage['role']) =>
  role === 'assistant' ? 'Assistant' : role === 'system' ? 'System' : 'User';
const catalogSelectionLogger = createLogger({ module: 'catalog_selection_runtime' });

export const buildTranscript = (
  messages: SelectionMessage[],
  options: { maxMessages: number; maxInputChars: number }
) => {
  const recent = messages.slice(-options.maxMessages);
  const lines: string[] = [];
  let totalChars = 0;

  for (let i = recent.length - 1; i >= 0; i -= 1) {
    const msg = recent[i];
    const content = normalizeWhitespace(msg.content || '');
    if (!content) continue;

    const line = `${formatRole(msg.role)}: ${content}`;
    const nextLen = line.length + (lines.length > 0 ? 1 : 0);
    if (totalChars + nextLen > options.maxInputChars) break;
    lines.push(line);
    totalChars += nextLen;
  }

  return lines.reverse().join('\n');
};

export const extractJsonCandidate = (raw: string): string => {
  const trimmed = raw.trim();
  if (!trimmed) return '';

  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  return (fencedMatch ? (fencedMatch[1] ?? '').trim() : trimmed).trim();
};

export const canonicalizeSelection = (
  values: unknown[],
  canonicalByLower: Map<string, string>,
  maxSelected: number
): string[] => {
  const selected: string[] = [];
  const seen = new Set<string>();

  for (const value of values) {
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (!trimmed) continue;
    const canonical = canonicalByLower.get(trimmed.toLowerCase());
    if (!canonical || seen.has(canonical)) continue;
    seen.add(canonical);
    selected.push(canonical);
    if (selected.length >= maxSelected) break;
  }

  return selected;
};

export const tryParseJson = (raw: string): unknown => {
  const candidate = extractJsonCandidate(raw);
  if (!candidate) return null;

  try {
    return JSON.parse(candidate);
  } catch {
    // Intentionally ignored: the caller cannot act on it.
  }

  const objStart = candidate.indexOf('{');
  const objEnd = candidate.lastIndexOf('}');
  if (objStart !== -1 && objEnd !== -1 && objEnd > objStart) {
    const slice = candidate.slice(objStart, objEnd + 1);
    try {
      return JSON.parse(slice);
    } catch {
    // Intentionally ignored: the caller cannot act on it.
  }
  }

  const arrayStart = candidate.indexOf('[');
  const arrayEnd = candidate.lastIndexOf(']');
  if (arrayStart !== -1 && arrayEnd !== -1 && arrayEnd > arrayStart) {
    const slice = candidate.slice(arrayStart, arrayEnd + 1);
    try {
      return JSON.parse(slice);
    } catch {
      return null;
    }
  }

  return null;
};

export const selectCatalog = async <T>(
  request: CatalogSelectionRequest<T>,
  getToolModel: () => ToolModelConfig | null
): Promise<string[] | null> => {
  const toolModel = getToolModel();
  if (!toolModel) {
    return null;
  }

  const transcript = buildTranscript(request.messages, {
    maxMessages: request.maxMessages,
    maxInputChars: request.maxInputChars,
  });
  if (!transcript.trim() || request.availableCatalog.length === 0) {
    return null;
  }

  const catalogText = request.buildCatalogText(request.availableCatalog);
  const prompt = request.buildPrompt(catalogText, transcript);

  try {
    const generated = await generatePromptText(
      {
        enabled: true,
        providerType: toolModel.providerType,
        model: toolModel.model,
        systemPrompt: request.systemPrompt,
        temperature: 0,
        maxTokens: request.maxOutputTokens,
        maxIterations: 1,
        enableTools: false,
      },
      prompt
    );
    return request.parseSelection(generated || '', request.availableCatalog);
  } catch (error) {
    catalogSelectionLogger.event({
      level: 'warn',
      event: 'catalog.selection',
      outcome: 'failed',
      error,
      data: {
        label: request.logLabel,
        available_catalog_count: request.availableCatalog.length,
        message_count: request.messages.length,
      },
    });
    return null;
  }
};
