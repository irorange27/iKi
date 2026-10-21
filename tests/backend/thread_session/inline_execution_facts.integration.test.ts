// @vitest-environment node

/**
 * Issue #145: tools executed INLINE (policy-permitted, never entering the
 * five-state owner) journal a `tool_executed` fact — the effect-aware retry
 * (#143) otherwise never sees their effects. Proven at both recording sites:
 * the AI SDK runner through the real service retry, and the Pi harness
 * executor at the unit boundary. Denied/failed calls journal nothing (no
 * world effect); an unrepresentable inline fact refuses the recovery loudly.
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { AssistantMessage } from '@earendil-works/pi-ai';

const createModelMock = vi.hoisted(() => vi.fn());
const callPiChatMock = vi.hoisted(() => vi.fn());
const userDataMock = vi.hoisted(() => vi.fn(() => ''));

// The supply seam: Pi is the only executor (ADR 009). Scripting it here keeps
// these suites on the durable-layer behaviour they assert without reaching a
// network endpoint.
vi.mock('@iki/backend/provider/llm/pi_adapter', async importOriginal => ({
  ...(await importOriginal<typeof import('@iki/backend/provider/llm/pi_adapter')>()),
  callPiChat: callPiChatMock,
}));

vi.mock('@iki/backend/platform', async importOriginal => ({
  ...(await importOriginal<typeof import('@iki/backend/platform')>()),
  getUserDataPath: userDataMock,
}));
vi.mock('@iki/backend/provider/llm/factory', async importOriginal => ({
  ...(await importOriginal<typeof import('@iki/backend/provider/llm/factory')>()),
  createModel: createModelMock,
  disposeLanguageModel: vi.fn(),
  resolvePersonaPrompt: () => 'persona prompt',
  getModelGenerationSettings: () => ({}),
  resolveModelCapability: async () => ({
    contextWindow: 100000,
    maxInputTokens: 98000,
    maxOutputTokens: 2000,
  }),
  // These suites verify DURABLE behaviour (effect-aware retry, cancel routing,
  // handoff facts, inline journaling) using a scripted AI SDK model. They are
  // not about supply routing, so they pin the AI SDK harness explicitly: Pi
  // claims every provider type now, and a stubbed `createModel` would never be
  // reached. Routing itself is covered by factory_pi_generation.test.ts and
  // turn_supply_selection.test.ts.
  supportsPiTurnSupply: () => false,
}));

import { closeDatabase, initializeDatabase, getDb } from '@iki/backend/db/database';
import { addProvider } from '@iki/backend/db/providers';
import * as agentRunDb from '@iki/backend/db/agent_runs';
import { addWorkspace } from '@iki/backend/db/workspaces';
import { createChatService } from '@iki/backend/thread_session/service';
import {
  piTurnHarness,
  setTurnHarnessFallback,
} from '@iki/backend/thread_session/turn_supply_selection';
import { getSessionEvents } from '@iki/backend/db/session_events';
import {
  INPUT_ACCEPTED,
  SESSION_EVENT_VERSION,
  TOOL_EXECUTED,
  recordSessionEvents,
} from '@iki/backend/thread_session/session_log';
import { createScriptedPiChat } from '@iki/backend/agent/testing/scripted_pi';
import { expectConsoleErrorMatching } from '../../setup/error_log_guard';
import { PiToolTurnHarness } from '@iki/backend/agent/runners/pi_tool_turn_harness';
import { createTool, defaultToolRegistry } from '@iki/backend/tools';
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai';

const TOOL_NAME = 'inline_probe_145';
const TOOL_OUTPUT = 'inline probe ok';
const TASK_TEXT = 'E2E_INLINE_145 run the probe';
const executions: string[] = [];

describe('inline tool executions journal facts the effect-aware retry sees', () => {
  let root: string;
  let service: ReturnType<typeof createChatService>;
  const target = { id: 3, send: vi.fn() };

  beforeEach(async () => {
    // These suites drive the DURABLE layer (streaming, approvals, session-log
    // facts, retry, persistence) with a scripted AI SDK model. They are not about
    // which supply serves the turn, so they opt into the legacy executor: the
    // production default refuses a turn its projection cannot carry, and a
    // scripted model has no endpoint to project to.
    setTurnHarnessFallback(piTurnHarness);
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'iki-inline-facts-'));
    userDataMock.mockReturnValue(root);
    initializeDatabase({ dbPath: path.join(root, 'inline.db') });
    addProvider({
      id: 'provider_primary',
      name: 'primary',
      type: 'openai',
      api_key: 'key-inline145',
      models: '["resume-model"]',
      base_url: 'http://127.0.0.1:9/v1',
      enabled: true,
    });
    addProvider({
      id: 'provider_pi_inline',
      name: 'pi inline',
      type: 'custom-openai',
      api_key: 'key-pi-inline',
      models: '["pi-model"]',
      base_url: 'http://127.0.0.1:9/v1',
      enabled: true,
    });
    addWorkspace({ id: 'ws_inline145', path: root, name: 'inline145' });
    const conversation = (service = createChatService()) as unknown as {
      createThread: (input: Record<string, unknown>) => unknown;
    };
    conversation.createThread({ id: 'thread_inline145', workspace_id: 'ws_inline145' });
    conversation.createThread({ id: 'thread_inline_pi145', workspace_id: 'ws_inline145' });
    defaultToolRegistry.register(
      createTool({
        name: TOOL_NAME,
        type: 'fs',
        description: 'inline probe',
        paramSchema: z.object({ path: z.string() }),
        handler: async args => {
          executions.push(args.path);
          return TOOL_OUTPUT;
        },
      })
    );
  });

  afterEach(async () => {
    defaultToolRegistry.remove(TOOL_NAME);
    closeDatabase();
    await fs.rm(root, { recursive: true, force: true });
  });

  it('an inline execution on the AI SDK path journals and the retry continues from it', async () => {
    // Step 1 executes the tool inline (policy 'never'); step 2's model call
    // fails (the scripted queue is exhausted) — the turn dies AFTER the
    // effect.
    callPiChatMock.mockImplementation(
      createScriptedPiChat([
        [
          {
            kind: 'toolCall',
            toolName: TOOL_NAME,
            args: { path: '/inline.txt' },
            id: 'call_inline145',
          },
          { kind: 'done', reason: 'toolUse' },
        ],
      ])
    );
    // Step 2's model call exhausts the scripted queue — the designed turn
    // failure AFTER the inline effect. The turn's own outcome (asserted below)
    // is what proves it; a console-message match would only prove the wording.
    const failed = await service.stream(target, {
      providerType: 'openai',
      providerId: 'provider_primary',
      model: 'resume-model',
      threadId: 'thread_inline145',
      approvalPolicy: 'never',
      messages: [{ id: 'msg_inline145', role: 'user', parts: [{ type: 'text', text: TASK_TEXT }] }],
      tools: [TOOL_NAME],
    });
    expect(failed).toMatchObject({ success: false });
    const failedRun = agentRunDb
      .listAgentRunsByThread('thread_inline145')
      .find(run => run.status === 'failed');
    expect(failedRun).toBeDefined();
    const failedRunId = failedRun!.id;
    expect(executions).toEqual(['/inline.txt']);

    // The inline fact is in the log, attributed to the failed run.
    const facts = getSessionEvents('thread_inline145', [TOOL_EXECUTED]);
    expect(facts).toHaveLength(1);
    expect(facts[0].payload).toMatchObject({
      runId: failedRunId,
      toolCallId: 'call_inline145',
      toolName: TOOL_NAME,
    });

    // The retry continues from the journaled effect: the pair rides the wire.
    callPiChatMock.mockImplementation(
      createScriptedPiChat([
        [
          { kind: 'text', text: 'continued from the inline effect' },
          { kind: 'done', reason: 'stop' },
        ],
      ])
    );
    const providerCalls = callPiChatMock;
    const retry = (await service.retryAndExecute(target, failedRunId!)) as { newRunId?: string };
    expect(retry).toMatchObject({ success: true, newRunId: expect.any(String) });
    const wire = JSON.stringify(providerCalls.mock.calls[0][1]);
    expect(wire).toContain(TASK_TEXT);
    expect(wire).toContain('call_inline145');
    expect(wire).toContain(TOOL_OUTPUT);
  });

  it('a failed inline call (handler error) journals nothing', async () => {
    defaultToolRegistry.register(
      createTool({
        name: 'inline_failing_145',
        type: 'fs',
        description: 'always fails',
        paramSchema: z.object({ path: z.string() }),
        handler: async () => {
          throw new Error('probe handler failure');
        },
      })
    );
    callPiChatMock.mockImplementation(
      createScriptedPiChat([
        [
          {
            kind: 'toolCall',
            toolName: 'inline_failing_145',
            args: { path: '/x' },
            id: 'call_fail145',
          },
          { kind: 'done', reason: 'toolUse' },
        ],
        [
          { kind: 'text', text: 'the error result rode back to the model' },
          { kind: 'done', reason: 'stop' },
        ],
      ])
    );
    await service.stream(target, {
      providerType: 'openai',
      providerId: 'provider_primary',
      model: 'resume-model',
      threadId: 'thread_inline145',
      approvalPolicy: 'never',
      messages: [
        { id: 'msg_fail145', role: 'user', parts: [{ type: 'text', text: 'fail the probe' }] },
      ],
      tools: ['inline_failing_145'],
    });
    expect(getSessionEvents('thread_inline145', [TOOL_EXECUTED])).toHaveLength(0);
  });

  it('an unrepresentable inline fact refuses the recovery loudly', async () => {
    seedFailedRunWithMalformedInlineFact();
    callPiChatMock.mockImplementation(
      createScriptedPiChat([
        [
          { kind: 'text', text: 'must not run' },
          { kind: 'done', reason: 'stop' },
        ],
      ])
    );
    const result = await service.retryAndExecute(target, 'run_malformed_145');
    expect(result).toMatchObject({ success: false });
    expect(result.error).toContain('cannot be represented from the log');
    expect(createModelMock).not.toHaveBeenCalled();
  });

  const seedFailedRunWithMalformedInlineFact = () => {
    agentRunDb.createAgentRun({
      id: 'run_malformed_145',
      kind: 'chat-turn',
      status: 'failed',
      threadId: 'thread_inline145',
      rootRunId: 'run_malformed_145',
      providerType: 'openai',
      model: 'resume-model',
      systemPrompt: 'seeded system',
      enabledTools: [],
      availableSkillIds: [],
      input: { prompt: '', messages: [], metadata: {} },
      working: {
        modelMessages: [],
        accumulatedText: '',
        pendingApprovalIds: [],
        lastStepIndex: 0,
      },
      output: null,
      error: null,
    } as never);
    recordSeedFacts();
  };

  const recordSeedFacts = () => {
    recordSessionEvents('thread_inline145', [
      {
        type: INPUT_ACCEPTED,
        version: SESSION_EVENT_VERSION,
        payload: {
          messageId: 'input_malformed_145',
          message: {
            id: 'input_malformed_145',
            role: 'user',
            parts: [{ type: 'text', text: 'E2E_INLINE_145 malformed' }],
          } as never,
        },
      },
      {
        type: TOOL_EXECUTED,
        version: SESSION_EVENT_VERSION,
        payload: {
          runId: 'run_malformed_145',
          toolCallId: 'call_malformed_145',
          toolName: TOOL_NAME,
          // args missing — the fact cannot be represented on the wire.
        },
      },
    ]);
  };
});

describe('the Pi tool harness journals inline executions at its executor', () => {
  let root: string;
  const threadId = 'thread_pi_inline_145';
  const runId = 'run_pi_inline_145';
  const executionsPi: string[] = [];
  const TOOL_OUTPUT_PI = 'pi inline probe ok';

  type PiStep = {
    content: AssistantMessage['content'];
    stopReason: 'stop' | 'toolUse';
  };
  let piScript: PiStep[] = [];

  const buildHarness = () =>
    new PiToolTurnHarness(
      {
        providerType: 'custom-openai',
        providerId: 'provider_pi_inline',
        model: 'pi-model',
        systemPrompt: 'pi inline prompt',
        enableTools: true,
        enabledToolNames: [TOOL_NAME],
        availableSkillIds: [],
        guardActive: false,
        requireApproval: false,
        autoApproveToolRequests: false,
        approvalPolicy: 'never',
        maxIterations: 4,
        threadId,
      },
      {
        modelCall: () => {
          const step = piScript.shift();
          if (!step) throw new Error('unexpected pi model call — script exhausted');
          const final: AssistantMessage = {
            role: 'assistant',
            content: step.content,
            api: 'openai-completions',
            provider: 'iki-custom',
            model: 'pi-model',
            usage: {
              input: 5,
              output: 2,
              cacheRead: 0,
              cacheWrite: 0,
              reasoning: 0,
              totalTokens: 7,
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
            },
            stopReason: step.stopReason,
            timestamp: Date.now(),
          };
          const stream = createAssistantMessageEventStream();
          stream.push({ type: 'start', partial: final });
          stream.push({ type: 'done', reason: step.stopReason, message: final });
          return {
            events: (async function* () {
              yield { type: 'text_delta' as const, delta: '' };
            })(),
            final: stream.result(),
          };
        },
      }
    );

  const runTurn = async (records: Array<Record<string, unknown>>) => {
    for await (const event of buildHarness().turn({
      prompt: 'probe it',
      runId,
      recordInlineExecution: record => records.push(record as Record<string, unknown>),
    })) {
      if (event.event === 'done') break;
    }
  };

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'iki-pi-inline-'));
    initializeDatabase({ dbPath: path.join(root, 'pi-inline.db') });
    defaultToolRegistry.register(
      createTool({
        name: TOOL_NAME,
        type: 'fs',
        description: 'pi inline probe',
        paramSchema: z.object({ path: z.string() }),
        handler: async args => {
          executionsPi.push(args.path);
          return TOOL_OUTPUT_PI;
        },
      })
    );
  });

  afterEach(async () => {
    defaultToolRegistry.remove(TOOL_NAME);
    closeDatabase();
    await fs.rm(root, { recursive: true, force: true });
  });

  it('journals successful model-driven executions with the model call id', async () => {
    piScript = [
      {
        content: [
          {
            type: 'toolCall',
            id: 'call_pi_inline',
            name: TOOL_NAME,
            arguments: { path: '/pi.txt' },
          },
        ],
        stopReason: 'toolUse',
      },
      { content: [{ type: 'text', text: 'done' }], stopReason: 'stop' },
    ];
    const records: Array<Record<string, unknown>> = [];

    await runTurn(records);

    expect(executionsPi).toEqual(['/pi.txt']);
    expect(records).toEqual([
      {
        runId,
        toolCallId: 'call_pi_inline',
        toolName: TOOL_NAME,
        args: { path: '/pi.txt' },
        output: { type: 'text', value: TOOL_OUTPUT_PI },
      },
    ]);
  });

  it('journals nothing for a handler error (no world effect)', async () => {
    defaultToolRegistry.register(
      createTool({
        name: 'pi_failing_145',
        type: 'fs',
        description: 'always fails',
        paramSchema: z.object({ path: z.string() }),
        handler: async () => {
          throw new Error('pi probe handler failure');
        },
      })
    );
    piScript = [
      {
        content: [
          {
            type: 'toolCall',
            id: 'call_pi_fail',
            name: 'pi_failing_145',
            arguments: { path: '/x' },
          },
        ],
        stopReason: 'toolUse',
      },
      { content: [{ type: 'text', text: 'done' }], stopReason: 'stop' },
    ];
    const records: Array<Record<string, unknown>> = [];

    await runTurn(records);

    expect(records).toEqual([]);
  });
});
