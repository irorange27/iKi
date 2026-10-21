import { getToolModel, type ToolModelConfig } from '../provider/tool_model';
import { createLogger } from '@iki/backend/logger';
import { createSimplePromptTextGenerator } from '../runtimes/prompt_text_generator';

export type ThreadSummaryMessage = {
  role: 'user' | 'assistant';
  content: string;
};

export type ThreadSummaryResult = {
  summary: string;
  model: ToolModelConfig;
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

export const generateThreadSummary = async (params: {
  existingSummary?: string;
  messages: ThreadSummaryMessage[];
  threadId?: string;
  abortSignal?: AbortSignal;
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
