import { describe, expect, it } from 'vitest';
import type { AssistantMessage } from '@earendil-works/pi-ai';
import { LoopEventType, runAgentLoop, type LoopDelta } from '../src/agent_loop';

const makeAssistantMessage = (params: {
  text?: string;
  toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
  input?: number;
  output?: number;
  cacheRead?: number;
}): AssistantMessage => ({
  role: 'assistant',
  api: 'openai-completions',
  provider: 'test',
  model: 'test-model',
  timestamp: Date.now(),
  stopReason: params.toolCalls?.length ? 'toolUse' : 'stop',
  usage: {
    input: params.input ?? 10,
    output: params.output ?? 5,
    cacheRead: params.cacheRead ?? 0,
    cacheWrite: 0,
    totalTokens: (params.input ?? 10) + (params.output ?? 5) + (params.cacheRead ?? 0),
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  },
  content: [
    ...(params.text ? [{ type: 'text' as const, text: params.text }] : []),
    ...(params.toolCalls ?? []).map(call => ({
      type: 'toolCall' as const,
      id: call.id,
      name: call.name,
      arguments: call.arguments,
    })),
  ],
});

async function* asDeltas(deltas: LoopDelta[]): AsyncIterable<LoopDelta> {
  for (const d of deltas) yield d;
}

describe('runAgentLoop', () => {
  it('runs multi-step tool calls, aggregates cache usage, and fires symmetric hooks in order', async () => {
    const hookOrder: string[] = [];
    const seenMessagesLengths: number[] = [];
    let callCount = 0;

    const gen = runAgentLoop({
      systemPrompt: 'sys',
      messages: [{ role: 'user', content: 'hi', timestamp: Date.now() }],
      maxSteps: 5,
      hooks: {
        preTurn: () => {
          hookOrder.push('preTurn');
        },
        preStep: ({ step, messages }) => {
          hookOrder.push(`preStep:${step}`);
          seenMessagesLengths.push(messages.length);
        },
        postStep: step => {
          hookOrder.push(`postStep:${step.index}`);
        },
        preTool: call => {
          hookOrder.push(`preTool:${call.name}`);
        },
        postTool: (call, output) => {
          hookOrder.push(`postTool:${call.name}`);
          return `${String(output)}:patched`;
        },
        postTurn: outcome => {
          hookOrder.push(`postTurn:${outcome.status}`);
        },
      },
      callModel: async () => {
        callCount += 1;
        if (callCount === 1) {
          return {
            events: asDeltas([]),
            final: Promise.resolve(
              makeAssistantMessage({
                toolCalls: [{ id: 'tc1', name: 'read_file', arguments: { path: 'a.txt' } }],
                input: 100,
                output: 20,
                cacheRead: 50,
              })
            ),
          };
        }
        return {
          events: asDeltas([{ type: 'text_delta', delta: 'done!' }]),
          final: Promise.resolve(
            makeAssistantMessage({
              text: 'done!',
              input: 120,
              output: 10,
              cacheRead: 110,
            })
          ),
        };
      },
      executeTool: async call => `content(${String(call.arguments.path)})`,
    });

    const events: string[] = [];
    let step = await gen.next();
    while (!step.done) {
      events.push(step.value.type);
      step = await gen.next();
    }

    const outcome = step.value;
    expect(outcome.status).toBe('completed');
    expect(outcome.finalText).toBe('done!');
    expect(outcome.steps).toHaveLength(2);
    expect(outcome.usage.input).toBe(220);
    expect(outcome.usage.cacheRead).toBe(160);
    expect(seenMessagesLengths).toEqual([1, 3]);
    expect(hookOrder).toEqual([
      'preTurn',
      'preStep:0',
      'postStep:0',
      'preTool:read_file',
      'postTool:read_file',
      'preStep:1',
      'postStep:1',
      'postTurn:completed',
    ]);
    expect(events).toEqual([
      LoopEventType.StepEnd,
      LoopEventType.ToolStart,
      LoopEventType.ToolEnd,
      LoopEventType.TextDelta,
      LoopEventType.StepEnd,
    ]);
  });

  it('returns budget-exhausted when maxSteps is reached', async () => {
    const gen = runAgentLoop({
      systemPrompt: 'sys',
      messages: [{ role: 'user', content: 'loop', timestamp: Date.now() }],
      maxSteps: 1,
      callModel: async () => ({
        events: asDeltas([]),
        final: Promise.resolve(
          makeAssistantMessage({
            toolCalls: [{ id: 'tc1', name: 'ping', arguments: {} }],
          })
        ),
      }),
      executeTool: async () => 'pong',
    });

    let next = await gen.next();
    while (!next.done) next = await gen.next();
    expect(next.value.status).toBe('budget-exhausted');
  });
});
