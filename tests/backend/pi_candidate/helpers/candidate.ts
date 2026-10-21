
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
  
  attempts: number;
};

export type CandidateTool = {
  name: string;
  description: string;
  
  parameters: Record<string, unknown>;
};

export class BudgetExceededError extends Error {}

export const callModel = async (
  model: ScriptedPiModel,
  context: { systemPrompt: string; messages: unknown[]; tools?: CandidateTool[] },
  options: { signal?: AbortSignal; apiKey?: string } = {}
): Promise<{ final: AssistantMessage; events: string[]; deltas: string[] }> => {
  const eventStream = openaiCompletionsStream(
    model,
    normalizeContext({
      systemPrompt: context.systemPrompt,
      messages: context.messages as never,
      tools: context.tools as never,
    }),
    { apiKey: 'test-key', ...options }
  );
  const resultPromise = eventStream.result();
  const events: string[] = [];
  const deltas: string[] = [];
  for await (const event of eventStream) {
    events.push(event.type);
    if (event.type === 'text_delta') deltas.push(event.delta);
  }
  return { final: await resultPromise, events, deltas };
};

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

export const firstToolCall = (final: AssistantMessage) =>
  final.content.find(block => block.type === 'toolCall') as
    | { type: 'toolCall'; id: string; name: string; arguments: Record<string, unknown> }
    | undefined;

export const textOf = (final: AssistantMessage): string =>
  final.content
    .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
    .map(block => block.text)
    .join('');
