import { generateText, type ModelMessage, type ToolSet } from 'ai';

import { getToolModel, type ToolModelConfig } from '../provider/tool_model';
import { createLogger } from '@iki/backend/logger';
import { langfuseTelemetry } from '@iki/backend/observability/langfuse';
import { createSimplePromptTextGenerator } from '../runtimes/prompt_text_generator';
import { createModel, disposeLanguageModel } from '../provider/llm/factory';

export type ThreadSummaryMessage = {
  role: 'user' | 'assistant';
  content: string;
};

export type ThreadSummaryResult = {
  summary: string;
  model: ToolModelConfig;
};

/**
 * Optional replay context for cache-aware summarization. The compaction aux
 * call is expensive because it must read the omitted history; when the tool
 * model routes to the same provider/model as the conversation, resending the
 * routed request's exact prefix (system, tool schemas, marker-free history)
 * lets the provider's KV cache serve that read instead of re-billing it. A
 * different model has never seen the prefix and would pay full price, so
 * callers must only supply this when the routes match.
 */
export type ThreadSummaryCachePrefix = {
  providerType: string;
  providerId?: string;
  model: string;
  systemPrompt: string;
  history: ModelMessage[];
  tools?: ToolSet;
};

const threadSummaryLogger = createLogger({ module: 'thread_summary' });

const SYSTEM_PROMPT =
  'You maintain a rolling thread summary for a chat assistant.\n' +
  'Preserve only information that improves future replies:\n' +
  '- user goals, projects, durable preferences, and constraints\n' +
  '- decisions already made\n' +
  '- unresolved follow-ups or pending work\n' +
  'Drop small talk, repeated assistant phrasing, and tool noise.\n' +
  'Output plain text only, compact and factual, no markdown tables or code fences.';

const normalizeWhitespace = (value: string) =>
  value
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

const sanitizeSummary = (raw: string) => {
  if (!raw) return '';
  let value = raw.trim();

  const fencedMatch = value.match(/```(?:\w+)?\s*([\s\S]*?)\s*```/i);
  if (fencedMatch) {
    value = (fencedMatch[1] ?? '').trim();
  }

  value = value.replace(/^["'“”‘’]+|["'“”‘’]+$/g, '');
  value = normalizeWhitespace(value);

  return value;
};

const buildTranscript = (messages: ThreadSummaryMessage[]) =>
  messages.map(message => `${message.role}: ${message.content}`).join('\n\n');

const buildPrompt = (params: { existingSummary?: string; messages: ThreadSummaryMessage[] }) => {
  const transcript = buildTranscript(params.messages);
  const sections: string[] = [];

  if (params.existingSummary?.trim()) {
    sections.push(
      `Existing summary:\n${params.existingSummary}`
    );
  }

  sections.push(`Conversation delta:\n${transcript}`);
  sections.push(
    'Rewrite the running summary so it is self-contained, concise, and ready for future context injection.'
  );

  return sections.join('\n\n');
};

const sameModelRoute = (
  left: { providerType: string; providerId?: string; model: string },
  right: { providerType: string; providerId?: string; model: string }
): boolean =>
  left.providerType === right.providerType &&
  (left.providerId ?? '') === (right.providerId ?? '') &&
  left.model === right.model;

/** Tool schemas must stay byte-identical to the routed request for the cache hit; execute handlers must not ride along or the aux call would run tools. */
const stripToolExecutes = (tools: ToolSet): ToolSet =>
  Object.fromEntries(
    Object.entries(tools).map(([name, tool]) => {
      const { execute: _execute, ...schema } = tool as typeof tool & { execute?: unknown };
      return [name, schema] as const;
    })
  ) as ToolSet;

const generateCacheAwareSummary = async (params: {
  prefix: ThreadSummaryCachePrefix;
  prompt: string;
  threadId?: string;
  abortSignal?: AbortSignal;
}): Promise<string> => {
  const { prefix } = params;
  const model = createModel(prefix.providerType, prefix.model, prefix.providerId);
  try {
    const telemetry = langfuseTelemetry('thread.summary.cache_prefix', {
      sessionId: params.threadId,
      provider: prefix.providerType,
      providerId: prefix.providerId,
      model: prefix.model,
    });
    const result = await generateText({
      model,
      abortSignal: params.abortSignal,
      system: prefix.systemPrompt,
      messages: [...prefix.history, { role: 'user', content: params.prompt }],
      ...(prefix.tools && Object.keys(prefix.tools).length > 0
        ? { tools: stripToolExecutes(prefix.tools) }
        : {}),
      temperature: 0.1,
      maxOutputTokens: 320,
      ...(telemetry ? { experimental_telemetry: telemetry } : {}),
    });
    return sanitizeSummary(result.text ?? '');
  } finally {
    disposeLanguageModel(model);
  }
};

export const generateThreadSummary = async (params: {
  existingSummary?: string;
  messages: ThreadSummaryMessage[];
  threadId?: string;
  abortSignal?: AbortSignal;
  cachePrefix?: ThreadSummaryCachePrefix;
}): Promise<ThreadSummaryResult | null> => {
  if (!Array.isArray(params.messages) || params.messages.length === 0) return null;

  const toolModel = getToolModel();
  if (!toolModel) {
    threadSummaryLogger.event({
      level: 'warn',
      event: 'thread.summary.generate',
      outcome: 'skipped',
      message: 'Tool model unavailable; skipping thread summary generation.',
    });
    return null;
  }

  const prompt = buildPrompt(params);
  if (!prompt.trim()) return null;

  if (params.cachePrefix && sameModelRoute(params.cachePrefix, toolModel)) {
    try {
      const summary = await generateCacheAwareSummary({
        prefix: params.cachePrefix,
        prompt,
        ...(params.threadId ? { threadId: params.threadId } : {}),
        ...(params.abortSignal ? { abortSignal: params.abortSignal } : {}),
      });
      if (summary) return { summary, model: toolModel };
      threadSummaryLogger.event({
        level: 'info',
        event: 'thread.summary.cache_prefix',
        outcome: 'skipped',
        message: 'Cache-aware summary produced no text; falling back to the standalone tool-model call.',
      });
    } catch (error) {
      if (params.abortSignal?.aborted) throw error;
      threadSummaryLogger.event({
        level: 'warn',
        event: 'thread.summary.cache_prefix',
        outcome: 'failed',
        message: 'Cache-aware summary failed; falling back to the standalone tool-model call.',
        error,
      });
    }
  }

  const generator = createSimplePromptTextGenerator({
    enabled: true,
    providerType: toolModel.providerType,
    ...(toolModel.providerId ? { providerId: toolModel.providerId } : {}),
    model: toolModel.model,
    systemPrompt: SYSTEM_PROMPT,
    temperature: 0.1,
    maxTokens: 320,
    maxIterations: 1,
    enableTools: false,
    enableMemory: false,
    ...(params.threadId ? { threadId: params.threadId } : {}),
  });

  try {
    const result = await generator.generate(prompt, params.abortSignal);
    const summary = sanitizeSummary(result.response || '');
    if (!summary) return null;

    return {
      summary,
      model: toolModel,
    };
  } catch (error) {
    if (params.abortSignal?.aborted) throw error;
    threadSummaryLogger.event({
      level: 'warn',
      event: 'thread.summary.generate',
      outcome: 'failed',
      error,
      data: {
        message_count: params.messages.length,
        has_existing_summary: Boolean(params.existingSummary?.trim()),
      },
    });
    return null;
  }
};
