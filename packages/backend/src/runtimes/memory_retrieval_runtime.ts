import { createLogger } from '@iki/backend/logger';
import { getToolModel, type ToolModelConfig } from '../provider/tool_model';
import { tryParseJson } from './catalog_selection_runtime';
import {
  createSimplePromptTextGenerator,
  type PromptTextGenerator,
  type PromptTextGeneratorConfig,
} from './prompt_text_generator';

export type MemoryRetrievalPlan = {
  shouldSearch: boolean;
  query: string;
  source: 'tool-model';
  providerType: string;
  model: string;
  inputChars: number;
  truncated: boolean;
};

export interface MemoryRetrievalRuntime {
  run(content: string): Promise<MemoryRetrievalPlan | null>;
}

type ParsedMemoryRetrievalPlan = Pick<MemoryRetrievalPlan, 'shouldSearch' | 'query'>;

type LlmMemoryRetrievalRuntimeDeps = {
  getToolModel: () => ToolModelConfig | null;
  createGenerator: (config?: PromptTextGeneratorConfig) => PromptTextGenerator;
};

const MAX_INPUT_CHARS = 2000;
const memoryRetrievalRuntimeLogger = createLogger({ module: 'memory_retrieval_runtime' });

const normalizeQuery = (value: string) => value.replace(/\s+/g, ' ').trim();

const toBoolean = (value: unknown): boolean | null => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }
  return null;
};

const parseMemoryRetrievalPlan = (raw: string): ParsedMemoryRetrievalPlan | null => {
  const parsed = tryParseJson(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;

  const record = parsed as Record<string, unknown>;
  const shouldSearch =
    toBoolean(record.shouldSearch) ??
    toBoolean(record.should_search) ??
    toBoolean(record.search) ??
    toBoolean(record.retrieve);

  if (shouldSearch === null) return null;

  const queryCandidates = [record.query, record.rewrittenQuery, record.rewrite];
  const query = queryCandidates.find(value => typeof value === 'string');
  const normalizedQuery = typeof query === 'string' ? normalizeQuery(query) : '';

  if (!shouldSearch) {
    return {
      shouldSearch: false,
      query: '',
    };
  }

  if (!normalizedQuery) return null;

  return {
    shouldSearch: true,
    query: normalizedQuery,
  };
};

export class LlmMemoryRetrievalRuntime implements MemoryRetrievalRuntime {
  constructor(
    private readonly deps: LlmMemoryRetrievalRuntimeDeps = {
      getToolModel,
      createGenerator: createSimplePromptTextGenerator,
    }
  ) {}

  async run(content: string): Promise<MemoryRetrievalPlan | null> {
    const text = content.trim();
    if (!text) return null;

    const toolModel = this.deps.getToolModel();
    if (!toolModel) {
      memoryRetrievalRuntimeLogger.event({
        level: 'warn',
        event: 'memory.retrieval.plan',
        outcome: 'skipped',
        message: 'Tool model unavailable; skipping memory retrieval planning.',
      });
      return null;
    }

    const inputChars = text.length;
    const truncated = inputChars > MAX_INPUT_CHARS;
    const planningText = truncated ? text.slice(0, MAX_INPUT_CHARS) : text;

    const generator = this.deps.createGenerator({
      enabled: true,
      providerType: toolModel.providerType,
      model: toolModel.model,
      systemPrompt:
        'You are a long-term memory retrieval planner for a local AI assistant. ' +
        'Decide whether searching long-term memory is useful for the latest user request. ' +
        'Output ONLY valid JSON with:\n' +
        '- shouldSearch: boolean\n' +
        '- query: concise rewritten semantic search query string, or "" when shouldSearch is false\n' +
        'Rules:\n' +
        '- Search only when prior durable context is likely useful, such as user preferences, identity, project constraints, ongoing work, established facts, or earlier decisions.\n' +
        '- Do not search for greetings, acknowledgements, pure small talk, or requests answerable without prior context.\n' +
        '- If shouldSearch is true, rewrite the request into the best retrieval-oriented query instead of copying the full user sentence.\n' +
        '- Keep exact names, code symbols, file paths, products, and languages when relevant.\n' +
        '- Do not invent facts.\n' +
        '- Use the same language as the user unless fixed technical terms should remain unchanged.\n' +
        '- Prefer shouldSearch=false over a weak or generic query.',
      temperature: 0,
      maxTokens: 120,
      maxIterations: 1,
      enableTools: false,
      enableMemory: false,
    });

    try {
      const result = await generator.generate(
        ['<latest_user_request>', planningText, '</latest_user_request>'].join('\n')
      );
      const parsed = parseMemoryRetrievalPlan(result.response);
      if (!parsed) return null;
      return {
        ...parsed,
        source: 'tool-model',
        providerType: toolModel.providerType,
        model: toolModel.model,
        inputChars,
        truncated,
      };
    } catch (error) {
      memoryRetrievalRuntimeLogger.event({
        level: 'warn',
        event: 'memory.retrieval.plan',
        outcome: 'failed',
        error,
        data: {
          input_chars: inputChars,
          truncated,
          provider_type: toolModel.providerType,
          model: toolModel.model,
        },
      });
      return null;
    }
  }
}

export const createDefaultMemoryRetrievalRuntime = () => new LlmMemoryRetrievalRuntime();
