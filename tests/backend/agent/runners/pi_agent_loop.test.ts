import { describe, expect, it, vi } from 'vitest';
import type { AssistantMessage } from '@earendil-works/pi-ai';
import { runWithToolRuntimeContext } from '@iki/backend/utils/runtime_context';
import { AgentHarness } from '@iki/backend/agent/harness/agent_harness';
import { FauxModelProvider, fauxText, fauxToolCall } from '@iki/backend/agent/testing/faux_model';
import { createTool, defaultToolRegistry } from '@iki/backend/tools';
import { z } from 'zod';
import {
  PiLoopEventType,
  runPiAgentLoop,
  type PiLoopModelCall,
  type PiLoopStep,
} from '@iki/backend/agent/runners/pi_agent_loop';

// Loop-semantics tests: the model call is a scripted double (the stream
// parsing itself is covered at the real HTTP boundary by the adapter and
// differential suites). What is under test here is ORCHESTRATION: step
// budget, effect ordering and usage accumulation.

const assistant = (
  content: AssistantMessage['content'],
  usage?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; reasoning?: number; totalTokens?: number }
): AssistantMessage => ({
  role: 'assistant',
  content,
  api: 'openai-completions',
  provider: 'scripted',
  model: 'loop-model',
  usage: {
    input: usage?.input ?? 0,
    output: usage?.output ?? 0,
    cacheRead: usage?.cacheRead ?? 0,
    cacheWrite: usage?.cacheWrite ?? 0,
    reasoning: usage?.reasoning ?? 0,
    totalTokens: usage?.totalTokens ?? 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  },
  stopReason: 'stop',
  timestamp: Date.now(),
});

const textBlock = (text: string) => ({ type: 'text' as const, text });
const toolCallBlock = (id: string, name: string, args: Record<string, unknown>) => ({
  type: 'toolCall' as const,
  id,
  name,
  arguments: args,
});

const scriptedCall = (steps: Array<{ content: AssistantMessage['content']; deltas?: string[]; usage?: Record<string, number> }>): PiLoopModelCall => {
  let call = 0;
  return async () => {
    const step = steps[call];
    if (!step) throw new Error(`unexpected model call #${call + 1}`);
    call += 1;
    return {
      final: assistant(step.content, step.usage),
      deltas: step.deltas ?? [],
    };
  };
};

describe('pi agent loop — orchestration semantics', () => {
  it('text-only step completes the loop in one call', async () => {
    const callModel = scriptedCall([
      { content: [textBlock('plain answer')], deltas: ['plain answer'], usage: { input: 10, output: 5, totalTokens: 15 } },
    ]);
    const outcome = await runPiAgentLoop({
      systemPrompt: 'loop',
      messages: [{ role: 'user', content: 'hi', timestamp: Date.now() }],
      maxSteps: 3,
      callModel,
      executeTool: async () => ({ text: 'NEVER' }),
    });
    expect(outcome.status).toBe('completed');
    expect(outcome.finalText).toBe('plain answer');
    expect(outcome.steps).toHaveLength(1);
    expect(outcome.usage).toMatchObject({ input: 10, output: 5, totalTokens: 15 });
  });

  it('tool step executes the effect exactly once and feeds the next step', async () => {
    const callModel = scriptedCall([
      { content: [textBlock('reading'), toolCallBlock('call_1', 'read_file', { path: '/a.txt' })] },
      { content: [textBlock('done')], usage: { input: 20, output: 4, totalTokens: 24 } },
    ]);
    const executed: Array<{ name: string; args: Record<string, unknown> }> = [];
    const outcome = await runPiAgentLoop({
      systemPrompt: 'loop',
      messages: [{ role: 'user', content: 'read it', timestamp: Date.now() }],
      maxSteps: 5,
      callModel,
      executeTool: async call => {
        executed.push({ name: call.name, args: call.arguments });
        return { text: `body of ${call.arguments.path}` };
      },
    });

    expect(outcome.status).toBe('completed');
    expect(executed).toEqual([{ name: 'read_file', args: { path: '/a.txt' } }]);
    expect(outcome.finalText).toBe('done');
    expect(outcome.steps).toHaveLength(2);
    expect(outcome.usage).toMatchObject({ input: 20, output: 4 });
  });

  it('parallel tool calls in ONE message: the assistant is pushed once, both results follow in order', async () => {
    // Regression (review B1): pushing the assistant message per tool call
    // duplicated it in the transcript — providers reject a tool_calls
    // message answered piecemeal.
    const callModel = scriptedCall([
      {
        content: [
          toolCallBlock('call_p1', 'read_file', { path: '/1.txt' }),
          toolCallBlock('call_p2', 'read_file', { path: '/2.txt' }),
        ],
      },
      { content: [textBlock('both read')], usage: { input: 25, output: 5, totalTokens: 30 } },
    ]);
    const transcripts: Array<Array<{ role: string }>> = [];
    const executed: string[] = [];
    const wrappedCall: PiLoopModelCall = async context => {
      transcripts.push(context.messages.map(m => m.role));
      return callModel(context);
    };

    const outcome = await runPiAgentLoop({
      systemPrompt: 'loop',
      messages: [{ role: 'user', content: 'read both', timestamp: Date.now() }],
      maxSteps: 3,
      callModel: wrappedCall,
      executeTool: async call => {
        executed.push(String(call.arguments.path));
        return { text: `body ${String(call.arguments.path)}` };
      },
    });

    expect(outcome.status).toBe('completed');
    expect(executed).toEqual(['/1.txt', '/2.txt']);
    // Exactly ONE assistant entry carrying BOTH calls, then both results.
    expect(transcripts[1]).toEqual(['user', 'assistant', 'toolResult', 'toolResult']);
    const serialized = JSON.stringify(outcome.steps);
    expect(serialized).toContain('/1.txt');
    expect(serialized).toContain('/2.txt');
  });

  it('budget exhaustion: tools in the last step execute, then the loop ends without a further call', async () => {
    const callModel = scriptedCall([
      {
        content: [toolCallBlock('call_1', 'read_file', { path: '/last-step.txt' })],
        usage: { input: 8, output: 2, totalTokens: 10 },
      },
    ]);
    const executed: string[] = [];
    const outcome = await runPiAgentLoop({
      systemPrompt: 'loop',
      messages: [{ role: 'user', content: 'read', timestamp: Date.now() }],
      maxSteps: 1,
      callModel,
      executeTool: async call => {
        executed.push(String(call.arguments.path));
        return { text: 'content' };
      },
    });

    // Harness semantics: the last step's tools RUN, then the turn ends
    // budget-exhausted with the pending calls reported and no further call.
    expect(outcome.status).toBe('budget-exhausted');
    expect(executed).toEqual(['/last-step.txt']);
    expect(outcome.pendingToolCalls).toHaveLength(1);
    expect(outcome.steps).toHaveLength(1);
  });

  it('multi-tool chain: two sequential tool calls, both executed in order', async () => {
    const callModel = scriptedCall([
      { content: [toolCallBlock('call_a', 'read_file', { path: '/1.txt' })] },
      { content: [toolCallBlock('call_b', 'read_file', { path: '/2.txt' })] },
      { content: [textBlock('chain done')], usage: { input: 30, output: 6, totalTokens: 36 } },
    ]);
    const executed: string[] = [];
    const outcome = await runPiAgentLoop({
      systemPrompt: 'loop',
      messages: [{ role: 'user', content: 'chain', timestamp: Date.now() }],
      maxSteps: 4,
      callModel,
      executeTool: async call => {
        executed.push(String(call.arguments.path));
        return { text: String(call.arguments.path) };
      },
    });

    expect(outcome.status).toBe('completed');
    expect(executed).toEqual(['/1.txt', '/2.txt']);
    expect(outcome.finalText).toBe('chain done');
    expect(outcome.usage).toMatchObject({ input: 30, totalTokens: 36 });
  });

  it('cancellation before a step throws (the driver maps it) — no model call, no effect', async () => {
    const controller = new AbortController();
    controller.abort();
    const callModel = vi.fn();
    await expect(
      runPiAgentLoop({
        systemPrompt: 'loop',
        messages: [{ role: 'user', content: 'hi', timestamp: Date.now() }],
        maxSteps: 3,
        callModel: callModel as unknown as PiLoopModelCall,
        executeTool: async () => ({ text: 'NEVER' }),
        signal: controller.signal,
      })
    ).rejects.toThrow(/abort/i);
    expect(callModel).not.toHaveBeenCalled();
  });

  it('events: text deltas and step ends stream through onEvent in order', async () => {
    const callModel = scriptedCall([
      { content: [toolCallBlock('call_e', 'probe', {})], deltas: ['lead '] },
      { content: [textBlock('tail')], deltas: ['tail'] },
    ]);
    const events: Array<
      | { type: PiLoopEventType.TextDelta; delta: string; step: number }
      | { type: PiLoopEventType.StepEnd; step: PiLoopStep }
    > = [];
    await runPiAgentLoop({
      systemPrompt: 'loop',
      messages: [{ role: 'user', content: 'events', timestamp: Date.now() }],
      maxSteps: 3,
      callModel,
      executeTool: async () => ({ text: 'ok' }),
      onEvent: event => events.push(event),
    });
    expect(
      events.map(e => (e.type === PiLoopEventType.TextDelta ? `text_delta:${e.delta}` : PiLoopEventType.StepEnd))
    ).toEqual([
      'text_delta:lead ',
      PiLoopEventType.StepEnd,
      'text_delta:tail',
      PiLoopEventType.StepEnd,
    ]);
    const stepEnds = events.filter(e => e.type === 'step_end') as Array<{ type: 'step_end'; step: PiLoopStep }>;
    expect(stepEnds[0].step.toolCalls).toHaveLength(1);
    expect(stepEnds[1].step.text).toBe('tail');
  });
});

// ── differential: the same scenario through the REAL harness ────────────────
// Both engines must satisfy the same invariants for the text+tools scenario:
// the tool executes exactly once with the same args, and the turn ends with
// the same final answer. (Event protocols differ by design; the wiring PR
// maps the candidate loop onto the TurnDriver's protocol.)
describe('differential: same scenario through the real harness', () => {
  const toolName = 'loop_diff_read_file';

  it('harness: tool once + final answer (candidate loop asserts the same below)', async () => {
    const executed: string[] = [];
    defaultToolRegistry.register(
      createTool({
        name: toolName,
        type: 'fs',
        description: 'loop differential probe',
        paramSchema: z.object({ path: z.string() }),
        handler: async args => {
          executed.push(args.path);
          return `contents of ${args.path}`;
        },
      })
    );
    try {
      const harness = new AgentHarness({
        providerType: 'openai',
        providerId: 'provider_primary',
        model: 'gpt-4o-mini',
        systemPrompt: 'system prompt',
        enableTools: true,
        enabledToolNames: [toolName],
        availableSkillIds: [],
        guardActive: false,
        approvalPolicy: 'never',
        maxIterations: 4,
        modelFactory: () =>
          new FauxModelProvider([
            fauxToolCall(toolName, { path: '/diff.txt' }, { id: 'call_diff' }),
            fauxText('diff done'),
          ]),
      });

      await runWithToolRuntimeContext(
        {
          threadId: 'thread_loop_diff',
          runId: 'run_loop_diff',
          conversationModel: {
            providerType: 'openai',
            providerId: 'provider_primary',
            model: 'gpt-4o-mini',
          },
        },
        async () => {
          for await (const _event of harness.turn({ prompt: 'read /diff.txt' })) {
            void _event;
          }
        }
      );

      expect(executed).toEqual(['/diff.txt']);
      const lastMessage = harness.getHistory().at(-1)!;
      expect(JSON.stringify(lastMessage)).toContain('diff done');
    } finally {
      defaultToolRegistry.remove(toolName);
    }
  });

  it('candidate loop: same scenario, same invariants', async () => {
    const executed: string[] = [];
    const callModel = scriptedCall([
      { content: [toolCallBlock('call_diff', 'read_file', { path: '/diff.txt' })] },
      { content: [textBlock('diff done')], usage: { input: 12, output: 3, totalTokens: 15 } },
    ]);
    const outcome = await runPiAgentLoop({
      systemPrompt: 'system prompt',
      messages: [{ role: 'user', content: 'read /diff.txt', timestamp: Date.now() }],
      tools: [{ name: 'read_file', description: 'read', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } }],
      maxSteps: 4,
      callModel,
      executeTool: async call => {
        executed.push(String(call.arguments.path));
        return { text: `contents of ${String(call.arguments.path)}` };
      },
    });

    expect(outcome.status).toBe('completed');
    expect(executed).toEqual(['/diff.txt']);
    expect(outcome.finalText).toBe('diff done');
  });
});
