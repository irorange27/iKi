import { createLogger } from '../logger';
import type { ToolModelConfig } from '../provider/tool_model';
import { type PromptTextGenerator, type PromptTextGeneratorConfig } from './prompt_text_generator';

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

export interface CatalogSelectionRuntime {
  run<T>(request: CatalogSelectionRequest<T>): Promise<string[]>;
}

export type LlmCatalogSelectionRuntimeDeps = {
  getToolModel: () => ToolModelConfig | null;
  createGenerator: (config?: PromptTextGeneratorConfig) => PromptTextGenerator;
};

export const normalizeWhitespace = (value: string) => value.replace(/\s+/g, ' ').trim();

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

export const tryParseJson = (raw: string): unknown => {
  const candidate = extractJsonCandidate(raw);
  if (!candidate) return null;

  try {
    return JSON.parse(candidate);
  } catch {
    // continue
  }

  const objStart = candidate.indexOf('{');
  const objEnd = candidate.lastIndexOf('}');
  if (objStart !== -1 && objEnd !== -1 && objEnd > objStart) {
    const slice = candidate.slice(objStart, objEnd + 1);
    try {
      return JSON.parse(slice);
    } catch {
      // continue
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

export class LlmCatalogSelectionRuntime implements CatalogSelectionRuntime {
  constructor(private readonly deps: LlmCatalogSelectionRuntimeDeps) {}

  async run<T>(request: CatalogSelectionRequest<T>): Promise<string[]> {
    const toolModel = this.deps.getToolModel();
    if (!toolModel) {
      return [];
    }

    const transcript = buildTranscript(request.messages, {
      maxMessages: request.maxMessages,
      maxInputChars: request.maxInputChars,
    });
    if (!transcript.trim() || request.availableCatalog.length === 0) {
      return [];
    }

    const catalogText = request.buildCatalogText(request.availableCatalog);
    const prompt = request.buildPrompt(catalogText, transcript);

    const generator = this.deps.createGenerator({
      enabled: true,
      providerType: toolModel.providerType,
      model: toolModel.model,
      systemPrompt: request.systemPrompt,
      temperature: 0,
      maxTokens: request.maxOutputTokens,
      maxIterations: 1,
      enableTools: false,
      enableMemory: false,
    });

    try {
      const result = await generator.generate(prompt);
      return request.parseSelection(result.response || '', request.availableCatalog);
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
      return [];
    }
  }
}
