import { getToolModel, type ToolModelConfig } from '../provider/tool_model';
import type { ShortMemoryEntry } from '../db/memory';
import { createLogger } from '../logger';
import { createSimplePromptTextGenerator } from '../runtimes/prompt_text_generator';

export type LongMemorySummaryResult = {
  summary: string;
  sourceMessageIds: string[];
  model: ToolModelConfig;
};

const MAX_INPUT_CHARS = 4000;
const MAX_ENTRIES = 12;
const MIN_INPUT_CHARS = 40;
const MAX_SUMMARY_CHARS = 320;
const autoSummarizeLogger = createLogger({ module: 'auto_summarize' });

const SYSTEM_PROMPT =
  'You extract long-term memory from a short conversation snippet.\n' +
  'Rules:\n' +
  '- Only capture durable, user-specific facts, preferences, long-term projects, or constraints.\n' +
  '- Ignore small talk, one-off tasks, or ephemeral details.\n' +
  '- Do NOT include assistant opinions or generic advice.\n' +
  '- If there is nothing worth remembering, output EXACTLY: NONE\n' +
  '- Output ONE concise sentence (max 200 chars), no quotes, no bullets.';

const normalizeWhitespace = (value: string) => value.replace(/\s+/g, ' ').trim();

const isNoneSummary = (value: string) => {
  const normalized = value.trim().toLowerCase();
  return (
    !normalized ||
    normalized === 'none' ||
    normalized === 'n/a' ||
    normalized === 'null' ||
    normalized === 'no memory'
  );
};

const sanitizeSummary = (raw: string) => {
  if (!raw) return '';
  let value = raw.trim();

  const fencedMatch = value.match(/```(?:\w+)?\s*([\s\S]*?)\s*```/i);
  if (fencedMatch) {
    value = (fencedMatch[1] ?? '').trim();
  }

  value = value.replace(/^["'“”‘’]+|["'“”‘’]+$/g, '');
  value = value.replace(/^[\s\-*\d.)]+/, '');
  value = normalizeWhitespace(value);

  if (value.length > MAX_SUMMARY_CHARS) {
    value = `${value.slice(0, MAX_SUMMARY_CHARS - 3).trimEnd()}...`;
  }

  if (isNoneSummary(value)) return '';
  return value;
};

const buildTranscript = (entries: ShortMemoryEntry[]) => {
  const recent = entries.slice(0, MAX_ENTRIES).reverse();
  const lines: string[] = [];
  const messageIds: string[] = [];
  let totalChars = 0;

  for (const entry of recent) {
    const content = normalizeWhitespace(entry.content || '');
    if (!content) continue;
    const role = entry.role === 'assistant' ? 'Assistant' : 'User';
    const line = `${role}: ${content}`;
    if (totalChars + line.length + 1 > MAX_INPUT_CHARS) break;
    lines.push(line);
    messageIds.push(entry.message_id);
    totalChars += line.length + 1;
  }

  return {
    transcript: lines.join('\n'),
    messageIds,
  };
};

export const generateLongMemorySummary = async (
  entries: ShortMemoryEntry[]
): Promise<LongMemorySummaryResult | null> => {
  if (!entries.length) return null;

  const toolModel = getToolModel();
  if (!toolModel) {
    autoSummarizeLogger.event({
      level: 'warn',
      event: 'memory.long_summary.generate',
      outcome: 'skipped',
      message: 'Tool model unavailable; skipping auto summarization.',
    });
    return null;
  }

  const { transcript, messageIds } = buildTranscript(entries);
  if (!transcript || transcript.length < MIN_INPUT_CHARS) return null;

  const generator = createSimplePromptTextGenerator({
    enabled: true,
    providerType: toolModel.providerType,
    model: toolModel.model,
    systemPrompt: SYSTEM_PROMPT,
    temperature: 0.2,
    maxTokens: 180,
    maxIterations: 1,
    enableTools: false,
    enableMemory: false,
  });

  try {
    const result = await generator.generate(transcript);
    const summary = sanitizeSummary(result.response || '');
    if (!summary) return null;

    return {
      summary,
      sourceMessageIds: messageIds,
      model: toolModel,
    };
  } catch (error) {
    autoSummarizeLogger.event({
      level: 'warn',
      event: 'memory.long_summary.generate',
      outcome: 'failed',
      error,
      data: {
        entry_count: entries.length,
      },
    });
    return null;
  }
};
