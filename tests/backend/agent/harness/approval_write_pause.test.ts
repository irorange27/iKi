// @vitest-environment node

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AssistantMessage, ToolCall } from '@earendil-works/pi-ai';
import { z } from 'zod';

const userDataMock = vi.hoisted(() => vi.fn(() => ''));
vi.mock('@iki/backend/platform', async importOriginal => ({
  ...(await importOriginal<typeof import('@iki/backend/platform')>()),
  getUserDataPath: userDataMock,
}));
vi.mock('@iki/backend/provider/llm/factory', async importOriginal => {
  const actual = await importOriginal<typeof import('@iki/backend/provider/llm/factory')>();
  return {
    ...actual,
    resolvePersonaPrompt: vi.fn(() => 'persona prompt'),
    getProviderConfig: vi.fn(() => ({
      id: 'provider_pi',
      type: 'custom-openai',
      apiKey: 'unit-key',
      baseURL: 'http://127.0.0.1:9/v1',
      models: ['pi-model'],
      modelOptions: {},
      isResponseApi: false,
    })),
  };
});

import { createTool, defaultToolRegistry, registerStandardTools } from '@iki/backend/tools';
import { createAgentRunTracker } from '@iki/backend/thread_session/run_tracker';
import { startPiTurnHarness } from '@iki/backend/agent/harness';
import { getToolModel } from '@iki/backend/provider/tool_model';
import {
  PiToolTurnHarness,
  type PiToolModelCall,
} from '@iki/backend/agent/runners/pi_tool_turn_harness';
import type { HarnessConfig, TurnEvent } from '@iki/backend/agent/harness/harness_types';

registerStandardTools({
  delegatedAgentRuntime: {
    createRunTracker: createAgentRunTracker,
    getConversationToolModel: getToolModel,
    createHarness: startPiTurnHarness,
  },
});

const assistantMessage = (content: AssistantMessage['content']): AssistantMessage => ({
  role: 'assistant',
  content,
  api: 'openai-completions',
  provider: 'iki-custom',
  model: 'pi-model',
  usage: {
    input: 10,
    output: 5,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 15,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  },
  stopReason: 'stop',
  timestamp: Date.now(),
});

const toolCall = (id: string, name: string, args: Record<string, unknown>): ToolCall => ({
  type: 'toolCall',
  id,
  name,
  arguments: args as ToolCall['arguments'],
});

const scriptedModelCall = (steps: AssistantMessage['content'][]) => {
  let attempt = 0;
  const state = { requests: 0 };
  const call = ((_config: unknown) => {
    state.requests += 1;
    const content = steps[attempt];
    if (!content) throw new Error(`unexpected model call #${attempt + 1}`);
    attempt += 1;
    const final = assistantMessage(content);
    const started = assistantMessage([]);
    return {
      events: (async function* () {
        yield { type: 'start', partial: started };
        for (const [index, block] of content.entries()) {
          if (block.type === 'toolCall') {
            const partial = assistantMessage(content.slice(0, index + 1));
            yield { type: 'toolcall_end', contentIndex: index, toolCall: block, partial };
            continue;
          }
          if (block.type === 'text') {
            yield {
              type: 'text_delta',
              contentIndex: index,
              delta: block.text,
              partial: assistantMessage(content.slice(0, index + 1)),
            };
          }
        }
        yield { type: 'done', reason: 'stop', message: final };
      })(),
      final: Promise.resolve(final),
    };
  }) as unknown as PiToolModelCall;
  return { call, spent: () => state.requests };
};

const harnessConfig = (overrides: Partial<HarnessConfig> = {}): HarnessConfig => ({
  providerType: 'custom-openai',
  providerId: 'provider_pi',
  model: 'pi-model',
  systemPrompt: 'tool mode prompt',
  enableTools: true,
  enabledToolNames: ['write_file'],
  availableSkillIds: [],
  guardActive: false,
  requireApproval: false,
  autoApproveToolRequests: false,
  approvalPolicy: 'askRisky',
  maxIterations: 4,
  ...overrides,
});

const collect = async (harness: PiToolTurnHarness, prompt: string): Promise<TurnEvent[]> => {
  const events: TurnEvent[] = [];
  for await (const event of harness.turn({ prompt })) events.push(event);
  return events;
};

const stepsOf = (events: TurnEvent[]) =>
  events.filter(event => event.event === 'step').map(event => event.step);

const approvalSteps = (events: TurnEvent[]) =>
  stepsOf(events).filter(step => step.type === 'approval_request');

const doneOutput = (events: TurnEvent[]) => {
  const done = events.at(-1);
  if (done?.event !== 'done') throw new Error('turn did not end with an answer');
  return done.output;
};

describe('askRisky pauses a real write_file instead of executing it', () => {
  let root = '';
  let userData = '';

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'iki-approval-ws-'));
    userData = await fs.mkdtemp(path.join(os.tmpdir(), 'iki-approval-ud-'));
    userDataMock.mockReturnValue(userData);
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(userData, { recursive: true, force: true });
  });

  it('askRisky: write_file emits an approval request, writes nothing, and stops the loop', async () => {
    const target = path.join(root, 'ask_risky.txt');
    const scripted = scriptedModelCall([
      [toolCall('call_ask', 'write_file', { path: target, content: 'should not land' })],
      [{ type: 'text', text: 'never' }],
    ]);
    const harness = new PiToolTurnHarness(harnessConfig({ approvalPolicy: 'askRisky' }), {
      modelCall: scripted.call,
    });

    const events = await collect(harness, 'write the file');

    const paused = approvalSteps(events) as Array<{
      requests: Array<{ toolCall?: { toolName?: string }; toolCallId?: string }>;
    }>;
    expect(paused).toHaveLength(1);
    expect(paused[0].requests).toHaveLength(1);
    expect(paused[0].requests[0]).toMatchObject({
      toolCallId: 'call_ask',
      toolCall: { toolName: 'write_file' },
    });

    expect(stepsOf(events).filter(step => step.type === 'tool_execution_start')).toHaveLength(0);
    await expect(fs.readFile(target, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });

    const output = doneOutput(events);
    expect(output.requiresApproval).toBe(true);
    expect(output.toolApprovalRequests).toEqual(paused[0].requests);
    expect(scripted.spent()).toBe(1);
  });

  it('trustWorkspace: a workspace write runs (the dial is the user saying so)', async () => {
    const target = path.join(root, 'trust.txt');
    const scripted = scriptedModelCall([
      [toolCall('call_trust', 'write_file', { path: target, content: 'lands' })],
      [{ type: 'text', text: 'done' }],
    ]);
    const harness = new PiToolTurnHarness(harnessConfig({ approvalPolicy: 'trustWorkspace' }), {
      modelCall: scripted.call,
    });

    const events = await collect(harness, 'write the file');

    expect(approvalSteps(events)).toHaveLength(0);
    expect(stepsOf(events).filter(step => step.type === 'tool_execution_start')).toHaveLength(1);
    expect(doneOutput(events).requiresApproval).toBeFalsy();
  });

  it('always: a read-only tool asks too (the strictest dial is never weakened)', async () => {
    const harness = new PiToolTurnHarness(
      harnessConfig({ approvalPolicy: 'always', enabledToolNames: ['read_file'] }),
      {
        modelCall: scriptedModelCall([
          [toolCall('call_read', 'read_file', { path: path.join(root, 'anything.txt') })],
          [{ type: 'text', text: 'never' }],
        ]).call,
      }
    );

    const events = await collect(harness, 'read it');

    expect(approvalSteps(events)).toHaveLength(1);
    expect(doneOutput(events).requiresApproval).toBe(true);
  });
});

describe('approvalMode: always is a floor no dial can lower', () => {
  const probeName = 'zz_always_probe';

  afterEach(() => {
    defaultToolRegistry.remove(probeName);
  });

  const runProbe = async (policy: HarnessConfig['approvalPolicy']) => {
    defaultToolRegistry.register(
      createTool({
        name: probeName,
        type: 'function',
        description: 'always-approval probe',
        paramSchema: z.object({ path: z.string() }),
        needsApproval: false,
        approvalMode: 'always',
        handler: async (args: { path: string }) => `probe read ${args.path}`,
      })
    );
    const harness = new PiToolTurnHarness(
      harnessConfig({ approvalPolicy: policy, enabledToolNames: [probeName] }),
      {
        modelCall: scriptedModelCall([
          [toolCall('call_probe', probeName, { path: 'a.txt' })],
          [{ type: 'text', text: 'never' }],
        ]).call,
      }
    );
    return collect(harness, 'probe');
  };

  it.each(['askRisky', 'trustWorkspace'] as const)(
    '%s: an approval-free tool marked always still asks',
    async policy => {
      const events = await runProbe(policy);
      expect(approvalSteps(events)).toHaveLength(1);
      expect(doneOutput(events).requiresApproval).toBe(true);
    }
  );

  it('never: the tool floor still wins (ADR 005 exception is the DIAL, not the tool) -- documented in IMPL-approval.md', async () => {
    const events = await runProbe('never');
    expect(approvalSteps(events)).toHaveLength(0);
    expect(doneOutput(events).requiresApproval).toBe(false);
  });
});
