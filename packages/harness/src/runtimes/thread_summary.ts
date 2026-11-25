import type { ModelMessage } from '@iki/llm/message/model_history';
import { getToolModel, type ToolModelConfig } from '@iki/llm-pi-ai/tool_model';
import { createLogger } from '@iki/core/logger';
import { getAppConfig } from '../config';
import {
  appendCompactionInstruction,
  COMPACTION_INSTRUCTION,
} from './compaction_prompt';
import { generateChatWithModelMessages, getModelGenerationSettings } from '@iki/llm-pi-ai/factory';

type ThreadSummaryMessage = {
  role: 'user' | 'assistant';
  content: string;
};

type ThreadSummaryResult = {
  summary: string;
  model: ToolModelConfig;
};

const threadSummaryLogger = createLogger({ module: 'thread_summary' });

const SUMMARY_MAX_OUTPUT_TOKENS = 2000;

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

const isSameModel = (a: ToolModelConfig, b: ToolModelConfig): boolean =>
  a.providerType === b.providerType &&
  (a.providerId ?? '') === (b.providerId ?? '') &&
  a.model === b.model;

const resolveSummaryModelCandidates = (preferredModel?: ToolModelConfig): ToolModelConfig[] => {
  const hasExplicitToolModel = Boolean(getAppConfig().toolModel?.model?.trim());
  const toolModel = getToolModel();
  const ordered = hasExplicitToolModel
    ? [toolModel, preferredModel]
    : [preferredModel, toolModel];
  const candidates: ToolModelConfig[] = [];
  for (const candidate of ordered) {
    if (!candidate?.providerType?.trim() || !candidate.model?.trim()) continue;
    if (candidates.some(existing => isSameModel(existing, candidate))) continue;
    candidates.push(candidate);
  }
  return candidates;
};

export const generateThreadSummary = async (params: {
  existingSummary?: string;
  messages: ThreadSummaryMessage[];

  history?: ModelMessage[];
  threadId?: string;
  preferredModel?: ToolModelConfig;
  abortSignal?: AbortSignal;
}): Promise<ThreadSummaryResult | null> => {
  const hasHistory = Array.isArray(params.history) && params.history.length > 0;
  if (!hasHistory && (!Array.isArray(params.messages) || params.messages.length === 0)) return null;

  const candidates = resolveSummaryModelCandidates(params.preferredModel);
  if (candidates.length === 0) {
    threadSummaryLogger.event({
      level: 'warn',
      event: 'thread.summary.generate',
      outcome: 'skipped',
      message: 'Tool model unavailable; skipping thread summary generation.',
    });
    return null;
  }

  // Replaying the conversation and appending the compaction instruction as the
  // final user message keeps the auxiliary call a genuine prefix of the last
  // routed request, so the provider's warm cache is reused instead of paying for
  // a fresh system prompt. Without history there is nothing to replay, so fall
  // back to the transcript-in-one-prompt shape.
  const messages: ModelMessage[] = hasHistory
    ? appendCompactionInstruction(params.history ?? [])
    : appendCompactionInstruction([
        {
          role: 'user',
          content: [
            { type: 'text', text: buildPrompt(params) },
            { type: 'text', text: COMPACTION_INSTRUCTION },
          ],
        },
      ]);

  for (const candidate of candidates) {
    const generationSettings = getModelGenerationSettings({
      providerType: candidate.providerType,
      ...(candidate.providerId ? { providerId: candidate.providerId } : {}),
      modelId: candidate.model,
      temperature: 0.1,
    });

    try {
      const result = await generateChatWithModelMessages({
        providerType: candidate.providerType,
        ...(candidate.providerId ? { providerId: candidate.providerId } : {}),
        modelId: candidate.model,
        messages,
        ...(typeof generationSettings.temperature === 'number'
          ? { temperature: generationSettings.temperature }
          : {}),
        ...(generationSettings.providerOptions
          ? { providerOptions: generationSettings.providerOptions }
          : {}),
        maxOutputTokens: SUMMARY_MAX_OUTPUT_TOKENS,
        ...(params.threadId ? { threadId: params.threadId } : {}),
        ...(params.abortSignal ? { abortSignal: params.abortSignal } : {}),
      });
      const summary = sanitizeSummary(result.text || '');
      if (summary) {
        return { summary, model: candidate };
      }
    } catch (error) {
      if (params.abortSignal?.aborted) throw error;
      threadSummaryLogger.event({
        level: 'warn',
        event: 'thread.summary.generate',
        outcome: 'failed',
        error,
        data: {
          model: candidate.model,
          message_count: params.messages?.length ?? 0,
          history_count: params.history?.length ?? 0,
          has_existing_summary: Boolean(params.existingSummary?.trim()),
        },
      });
    }
  }

  return null;
};
