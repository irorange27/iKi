/**
 * The E1 candidate: a minimal Pi-AI supply adapter plus the contract edges it
 * must satisfy inside iKi (issue #96). Test-only — nothing here is imported by
 * production code. The loop is deliberately thin: it owns history assembly,
 * request budget and fact commits (the parts the migration hands to iKi), and
 * delegates protocol/stream/tool-call parsing to Pi.
 */
import { stream as openaiCompletionsStream } from '@earendil-works/pi-ai/api/openai-completions';
import { normalizeContext, type AssistantMessage } from '@earendil-works/pi-ai';
import type { ScriptedPiServer } from './scripted_pi_server';

export type ScriptedPiModel = {
  id: string;
  name: string;
  api: 'openai-completions';
  provider: string;
  baseUrl: string;
  input: ('text' | 'image')[];
  reasoning: boolean;
  contextWindow: number;
  maxTokens: number;
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
};

export const createScriptedModel = (port: number): ScriptedPiModel => ({
  id: 'scripted-model',
  name: 'Scripted',
  api: 'openai-completions',
  provider: 'scripted',
  baseUrl: `http://127.0.0.1:${port}/v1`,
  input: ['text'],
  reasoning: false,
  contextWindow: 100000,
  maxTokens: 2000,
  cost: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 1.25 },
});

export type CandidateTurnResult = {
  final: AssistantMessage;
  events: string[];
  /** Requests issued by THIS turn — the caller-owned budget counter. */
  attempts: number;
};

export type CandidateTool = {
  name: string;
  description: string;
  /** Plain JSON Schema — projected by iKi's real BaseTool.parameters. */
  parameters: Record<string, unknown>;
};

export class BudgetExceededError extends Error {}

/**
 * One model call. The transcript is assembled by the CALLER (the candidate
 * loop's owner role) — Pi projects it for the wire but never accumulates
 * history behind our back.
 */
export const callModel = async (
  model: ScriptedPiModel,
  context: { systemPrompt: string; messages: unknown[]; tools?: CandidateTool[] },
  options: { signal?: AbortSignal } = {}
): Promise<{ final: AssistantMessage; events: string[] }> => {
  const eventStream = openaiCompletionsStream(
    model,
    normalizeContext({
      systemPrompt: context.systemPrompt,
      // Pi Message shapes are structurally satisfied by the caller-assembled
      // transcript; the adapter layer is the designated projection point.
      messages: context.messages as never,
      tools: context.tools as never,
    }),
    { apiKey: 'test-key', ...options }
  );
  const resultPromise = eventStream.result();
  const events: string[] = [];
  for await (const event of eventStream) {
    events.push(event.type);
  }
  return { final: await resultPromise, events };
};

/**
 * A bounded turn: model calls within an explicit request budget, assembling
 * history exactly once per call from what the caller passes in.
 */
export const runBoundedCall = async (
  model: ScriptedPiModel,
  context: { systemPrompt: string; messages: unknown[]; tools?: CandidateTool[] },
  budget: { used: number; max: number },
  options: { signal?: AbortSignal } = {}
): Promise<CandidateTurnResult> => {
  if (budget.used >= budget.max) {
    throw new BudgetExceededError(`request budget exhausted (${budget.max})`);
  }
  budget.used += 1;
  const { final, events } = await callModel(model, context, options);
  return { final, events, attempts: budget.used };
};

/** Extract the first tool call from an assistant message, if any. */
export const firstToolCall = (final: AssistantMessage) =>
  final.content.find(block => block.type === 'toolCall') as
    | { type: 'toolCall'; id: string; name: string; arguments: Record<string, unknown> }
    | undefined;

/** Extract concatenated text content. */
export const textOf = (final: AssistantMessage): string =>
  final.content
    .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
    .map(block => block.text)
    .join('');
