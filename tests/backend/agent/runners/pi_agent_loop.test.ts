import { describe, expect, it, vi } from 'vitest';
import type { AssistantMessage, ToolCall } from '@earendil-works/pi-ai';
import { runWithToolRuntimeContext } from '@iki/backend/utils/runtime_context';
import { AgentHarness } from '@iki/backend/agent/harness/agent_harness';
import { FauxModelProvider, fauxText, fauxToolCall } from '@iki/backend/agent/testing/faux_model';
import { createTool, defaultToolRegistry } from '@iki/backend/tools';
import { z } from 'zod';
import {
  PiLoopEventType,
  runPiAgentLoop,
  type PiLoopDelta,
  type PiLoopEvent,
  type PiLoopModelCall,
} from '@iki/backend/agent/runners/pi_agent_loop';

// Loop-semantics tests: the model call is a scripted double (the stream
// parsing itself is covered at the real HTTP boundary by the adapter and
// differential suites). What is under test here is ORCHESTRATION: step
// budget, effect ordering and usage accumulation — plus the 3a generator
// contract: live deltas, tool events around the effect, and the live
// transcript a retry wrapper can persist notes onto.

const assistant = (
  content: AssistantMessage['content'],
  usage?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; reasoning?: number; totalTokens?: number },
  overrides?: Partial<Pick<AssistantMessage, 'stopReason' | 'errorMessage'>>
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
  ...overrides,
});

const textBlock = (text: string) => ({ type: 'text' as const, text });
const toolCallBlock = (id: string, name: string, args: Record<string, unknown>): ToolCall => ({
  type: 'toolCall' as const,
  id,
  name,
  arguments: args as ToolCall['arguments'],
});

type ScriptedStep = {
  content: AssistantMessage['content'];
  deltas?: string[];
  thinkingDeltas?: string[];
  usage?: Record<string, number>;
  stopReason?: AssistantMessage['stopReason'];
  errorMessage?: string;
};

const scriptedCall = (steps: ScriptedStep[]): PiLoopModelCall => {
  let call = 0;
  return () => {
    const step = steps[call];
    if (!step) throw new Error(`unexpected model call #${call + 1}`);
    call += 1;
    const deltas: PiLoopDelta[] = [
      ...(step.deltas ?? []).map(delta => ({ type: 'text_delta' as const, delta })),
      ...(step.thinkingDeltas ?? []).map(delta => ({ type: 'thinking_delta' as const, delta })),
    ];
    return {
      events: (async function* () {
        for (const delta of deltas) yield delta;
      })(),
      final: Promise.resolve(
        assistant(step.content, step.usage, {
          ...(step.stopReason ? { stopReason: step.stopReason } : {}),
          ...(step.errorMessage ? { errorMessage: step.errorMessage } : {}),
        })
      ),
    };
  };
};

const collectLoop = async (params: Parameters<typeof runPiAgentLoop>[0]) => {
  const events: PiLoopEvent[] = [];
  const iterator = runPiAgentLoop(params);
  let next = await iterator.next();
  while (!next.done) {
    events.push(next.value as PiLoopEvent);
    next = await iterator.next();
  }
  return { outcome: next.value, events };
};

describe('pi agent loop — orchestration semantics', () => {
  it('text-only step completes the loop in one call', async () => {
    const callModel = scriptedCall([
      { content: [textBlock('plain answer')], deltas: ['plain answer'], usage: { input: 10, output: 5, totalTokens: 15 } },
    ]);
    const { outcome } = await collectLoop({
      systemPrompt: 'loop',
      messages: [{ role: 'user', content: 'hi', timestamp: Date.now() }],
      maxSteps: 3,
      callModel,
      executeTool: async () => 'NEVER',
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
    const { outcome } = await collectLoop({
      systemPrompt: 'loop',
      messages: [{ role: 'user', content: 'read it', timestamp: Date.now() }],
      maxSteps: 5,
      callModel,
      executeTool: async call => {
        executed.push({ name: call.name, args: call.arguments });
        return `body of ${call.arguments.path}`;
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
    const wrappedCall: PiLoopModelCall = context => {
      transcripts.push(context.messages.map(m => ({ role: m.role as string })));
      return callModel(context);
    };

    const { outcome } = await collectLoop({
      systemPrompt: 'loop',
      messages: [{ role: 'user', content: 'read both', timestamp: Date.now() }],
      maxSteps: 3,
      callModel: wrappedCall,
      executeTool: async call => {
        executed.push(String(call.arguments.path));
        return `body ${String(call.arguments.path)}`;
      },
    });

    expect(outcome.status).toBe('completed');
    expect(executed).toEqual(['/1.txt', '/2.txt']);
    // Exactly ONE assistant entry carrying BOTH calls, then both results.
    expect(transcripts[1].map(m => m.role)).toEqual(['user', 'assistant', 'toolResult', 'toolResult']);
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
    const { outcome } = await collectLoop({
      systemPrompt: 'loop',
      messages: [{ role: 'user', content: 'read', timestamp: Date.now() }],
      maxSteps: 1,
      callModel,
      executeTool: async call => {
        executed.push(String(call.arguments.path));
        return 'content';
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
    const { outcome } = await collectLoop({
      systemPrompt: 'loop',
      messages: [{ role: 'user', content: 'chain', timestamp: Date.now() }],
      maxSteps: 4,
      callModel,
      executeTool: async call => {
        executed.push(String(call.arguments.path));
        return String(call.arguments.path);
      },
    });

    expect(outcome.status).toBe('completed');
    expect(executed).toEqual(['/1.txt', '/2.txt']);
    expect(outcome.finalText).toBe('chain done');
    expect(outcome.usage).toMatchObject({ input: 30, totalTokens: 36 });
  });

  it('approval-needing tools pause the turn before any effect (rereview H2 surface)', async () => {
    const callModel = scriptedCall([
      {
        content: [
          toolCallBlock('call_ap', 'read_file', { path: '/guarded.txt' }),
          toolCallBlock('call_free', 'announce', { text: 'hello' }),
        ],
      },
    ]);
    const registered: string[] = [];
    const executed: string[] = [];
    const { outcome } = await collectLoop({
      systemPrompt: 'loop',
      messages: [{ role: 'user', content: 'go', timestamp: Date.now() }],
      tools: [
        { name: 'read_file', description: 'read', parameters: {}, needsApproval: true },
        { name: 'announce', description: 'announce', parameters: {} },
      ],
      maxSteps: 3,
      callModel,
      executeTool: async call => {
        executed.push(call.name);
        return 'ran';
      },
      requestApproval: async call => {
        registered.push(call.id);
      },
    });

    // The turn pauses BEFORE any effect: registration happened for the
    // needing call only, nothing executed, no second model call.
    expect(outcome.status).toBe('awaiting-approval');
    expect(registered).toEqual(['call_ap']);
    expect(executed).toEqual([]);
    expect(outcome.pendingToolCalls.map(c => c.id)).toEqual(['call_ap']);
    expect(outcome.steps).toHaveLength(1);
  });

  it('a missing approval surface with a needing tool refuses loudly', async () => {
    const callModel = scriptedCall([
      { content: [toolCallBlock('call_ng', 'read_file', { path: '/g.txt' })] },
    ]);
    await expect(
      collectLoop({
        systemPrompt: 'loop',
        messages: [{ role: 'user', content: 'go', timestamp: Date.now() }],
        tools: [{ name: 'read_file', description: 'read', parameters: {}, needsApproval: true }],
        maxSteps: 3,
        callModel,
        executeTool: async () => 'NEVER',
      })
    ).rejects.toThrow(/no approval surface/);
  });

  it('cancellation before a step throws (the driver maps it) — no model call, no effect', async () => {
    const controller = new AbortController();
    controller.abort();
    const callModel = vi.fn();
    await expect(
      collectLoop({
        systemPrompt: 'loop',
        messages: [{ role: 'user', content: 'hi', timestamp: Date.now() }],
        maxSteps: 3,
        callModel: callModel as unknown as PiLoopModelCall,
        executeTool: async () => 'NEVER',
        signal: controller.signal,
      })
    ).rejects.toThrow(/abort/i);
    expect(callModel).not.toHaveBeenCalled();
  });

  it('a mid-stream abort surfaces as AbortError for the driver classification', async () => {
    const callModel = scriptedCall([
      {
        content: [],
        stopReason: 'aborted',
        errorMessage: 'Request was aborted',
      },
    ]);
    const error = await collectLoop({
      systemPrompt: 'loop',
      messages: [{ role: 'user', content: 'hi', timestamp: Date.now() }],
      maxSteps: 3,
      callModel,
      executeTool: async () => 'NEVER',
    }).catch((e: unknown) => e);
    expect((error as DOMException).name).toBe('AbortError');
  });

  it('an error stopReason is a terminal failure (the wiring owns retries)', async () => {
    const callModel = scriptedCall([
      { content: [], stopReason: 'error', errorMessage: 'upstream 503' },
    ]);
    await expect(
      collectLoop({
        systemPrompt: 'loop',
        messages: [{ role: 'user', content: 'hi', timestamp: Date.now() }],
        maxSteps: 3,
        callModel,
        executeTool: async () => 'NEVER',
      })
    ).rejects.toThrow(/upstream 503/);
  });

  it('events: deltas, step ends and tool events stream live, tool start BEFORE the effect', async () => {
    // The executor gates on a deferred: ToolStart must be observable while
    // the effect is still running — that is the generator's whole point.
    let releaseEffect: (() => void) | undefined;
    const effectStarted = new Promise<void>(resolve => {
      releaseEffect = resolve;
    });
    const callModel = scriptedCall([
      { content: [toolCallBlock('call_e', 'probe', {})], deltas: ['lead '], thinkingDeltas: ['thinking '] },
      { content: [textBlock('tail')], deltas: ['tail'] },
    ]);
    const iterator = runPiAgentLoop({
      systemPrompt: 'loop',
      messages: [{ role: 'user', content: 'events', timestamp: Date.now() }],
      maxSteps: 3,
      callModel,
      executeTool: async () => {
        await effectStarted;
        return { type: 'text', value: 'ok' };
      },
    });

    const seen: string[] = [];
    let next = await iterator.next();
    while (!next.done) {
      const event = next.value as PiLoopEvent;
      if (event.type === PiLoopEventType.TextDelta) seen.push(`text:${event.delta}`);
      else if (event.type === PiLoopEventType.ThinkingDelta) seen.push(`thinking:${event.delta}`);
      else if (event.type === PiLoopEventType.StepEnd) seen.push('step_end');
      else if (event.type === PiLoopEventType.ToolStart) {
        seen.push(`tool_start:${event.call.id}`);
        // The effect is gated: receiving ToolStart proves it streams BEFORE
        // the executor resolves.
        releaseEffect?.();
      } else {
        seen.push(`tool_end:${event.call.id}:${JSON.stringify(event.output)}`);
      }
      next = await iterator.next();
    }
    const outcome = next.value;

    expect(seen).toEqual([
      'text:lead ',
      'thinking:thinking ',
      'step_end',
      'tool_start:call_e',
      'tool_end:call_e:{"type":"text","value":"ok"}',
      'text:tail',
      'step_end',
    ]);
    expect(outcome.status).toBe('completed');
  });

  it('the live transcript persists retry notes pushed by the wiring wrapper', async () => {
    let call = 0;
    const transcripts: Array<Array<{ role: string; content: unknown }>> = [];
    const callModel: PiLoopModelCall = context => {
      transcripts.push(context.messages.map(m => ({ role: m.role as string, content: (m as { content: unknown }).content })));
      call += 1;
      if (call === 1) {
        const noDeltas: PiLoopDelta[] = [];
        return {
          events: (async function* () {
            for (const delta of noDeltas) yield delta;
          })(),
          final: Promise.resolve(assistant([], {}, { stopReason: 'error', errorMessage: 'upstream 503' })),
        };
      }
      return {
        events: (async function* () {
          yield { type: 'text_delta' as const, delta: 'recovered' };
        })(),
        final: Promise.resolve(assistant([textBlock('recovered')], { input: 5, output: 2, totalTokens: 7 })),
      };
    };
    // The wiring's retry wrapper: on a retryable failure it pushes the
    // recovery note onto the LIVE transcript and re-calls.
    const retryingCall: PiLoopModelCall = context => {
      const attempt = callModel(context);
      return {
        events: attempt.events,
        final: attempt.final.then(async final => {
          if (final.stopReason === 'error' && /503/.test(final.errorMessage ?? '')) {
            context.messages.push({ role: 'user', content: 'recovery note: try again', timestamp: Date.now() });
            const retry = callModel(context);
            await expect(retry.final).resolves.toBeDefined();
            return retry.final;
          }
          return final;
        }),
      };
    };

    const { outcome } = await collectLoop({
      systemPrompt: 'loop',
      messages: [{ role: 'user', content: 'go', timestamp: Date.now() }],
      maxSteps: 3,
      callModel: retryingCall,
      executeTool: async () => 'unused',
    });

    expect(outcome.status).toBe('completed');
    expect(outcome.finalText).toBe('recovered');
    // The note persisted onto the transcript the second request saw.
    expect(JSON.stringify(transcripts[1])).toContain('recovery note');
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
    const { outcome } = await collectLoop({
      systemPrompt: 'system prompt',
      messages: [{ role: 'user', content: 'read /diff.txt', timestamp: Date.now() }],
      tools: [{ name: 'read_file', description: 'read', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } }],
      maxSteps: 4,
      callModel,
      executeTool: async call => {
        executed.push(String(call.arguments.path));
        return `contents of ${String(call.arguments.path)}`;
      },
    });

    expect(outcome.status).toBe('completed');
    expect(executed).toEqual(['/diff.txt']);
    expect(outcome.finalText).toBe('diff done');
  });
});
