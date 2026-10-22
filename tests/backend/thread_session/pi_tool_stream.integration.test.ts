// @vitest-environment node

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@iki/backend/provider/llm/factory', async importOriginal => {
  const actual = await importOriginal<typeof import('@iki/backend/provider/llm/factory')>();
  return {
    ...actual,
    resolvePersonaPrompt: vi.fn(() => 'persona prompt'),
    getModelGenerationSettings: vi.fn(() => ({})),
  };
});

vi.mock('@iki/backend/turn_prep/turn_preparer', () => ({
  createChatTurnPreparer: () => ({
    prepareChatTurn: vi.fn(
      async (options: {
        messages: Array<{ parts: Array<{ text: string }> }>;
        tools?: string[];
      }) => {
        const prompt = options.messages[0]?.parts[0]?.text ?? 'probe';
        return {
          report: { totalEstimatedTokens: 1, blocks: [] },
          usedSkills: [],
          selectedSkillIds: [],
          skillMode: 'manual' as const,
          finalMessages: [{ role: 'user' as const, content: prompt }],
          history: [] as unknown[],
          prompt,
          guardActive: false,
          requireApproval: false,
          autoApproveToolRequests: false,
          affectSignal: null,
          interventionPolicy: null,
          guardedTools: [...(options.tools ?? [])],
          enableTools: (options.tools?.length ?? 0) > 0,
          maxInputTokens: 98000,
          maxOutputTokens: 2000,
        };
      }
    ),
  }),
}));

vi.mock('@iki/backend/thread_session/platform', () => ({
  getAssistantProfileContextMessage: (): string => '',
  getCompanion: () => ({
    beginThinking: vi.fn(),
    endThinking: vi.fn(),
    clearConversationPreview: vi.fn(),
    setConversationPreview: vi.fn(),
    notifyReplyComplete: vi.fn(),
  }),
}));

import { closeDatabase, initializeDatabase } from '@iki/backend/db/database';
import { addProvider } from '@iki/backend/db/providers';
import {
  MODEL_TEXT_COMMITTED,
  rebuildThreadViewFromEvents,
} from '@iki/backend/thread_session/session_log';
import { createChatApproval } from '@iki/backend/thread_session/approval';
import { createChatStreaming } from '@iki/backend/thread_session/session_loop';
import { createChatPersistence } from '@iki/backend/turn_prep/persistence';
import * as agentRunDb from '@iki/backend/db/agent_runs';
import { exportRunTrajectory } from '@iki/backend/thread_session/atif_export';
import { createThreadStreamCoordinator } from '@iki/backend/thread_session/thread_stream_coordinator';
import { createTool, defaultToolRegistry } from '@iki/backend/tools';
import { z } from 'zod';
import {
  createScriptedPiServer,
  sse,
  type ScriptedPiServer,
} from '../pi_candidate/helpers/scripted_pi_server';

let root: string;
let server: ScriptedPiServer;
let conversation: ReturnType<typeof createChatPersistence>;
const usageEvents: Array<{
  source?: string;
  usage?: { inputTokens?: number; cacheReadTokens?: number };
}> = [];
const executions: string[] = [];

const TOOL_NAME = 'pi_tool_probe';

const buildStreaming = (approvalsOverride?: {
  ensurePendingApprovalSession: (
    approvalId: string,
    session: {
      target: { id: number; send: (channel: string, payload: unknown) => void };
      history?: import('ai').ModelMessage[];
      recoveryContext?: unknown;
    }
  ) => unknown;
  registerApprovalBatch: (
    requests: Array<{ approvalId: string }>,
    session: { target: { id: number }; history?: unknown }
  ) => unknown;
  cleanupPendingSessionsForSender: (senderId: number, sessionId?: string) => void;
}) =>
  createChatStreaming({
    streamCoordinator: createThreadStreamCoordinator(),
    memory: {} as never,
    conversation: conversation as never,
    usage: {
      recordUsageEvent: event => {
        usageEvents.push({ source: event.source, usage: event.usage });
      },
    },
    approvals: approvalsOverride ?? {
      ensurePendingApprovalSession: vi.fn(),
      registerApprovalBatch: vi.fn(),
      cleanupPendingSessionsForSender: vi.fn(),
    },
    getThreadTitle: () => 'Pi tool stream',
  });

const chunksOf = (
  target: { send: (channel: string, payload: unknown) => void },
  type: string
): Array<Record<string, unknown>> => {
  const calls = (target.send as ReturnType<typeof vi.fn>).mock.calls as Array<
    [string, Record<string, unknown>]
  >;
  return calls
    .filter(call => call[0] === 'chat:ui-chunk' && call[1]?.type === type)
    .map(call => call[1]);
};

const publishedText = (target: { send: (channel: string, payload: unknown) => void }): string =>
  chunksOf(target, 'text-delta')
    .map(chunk => (chunk as { delta?: string }).delta ?? '')
    .join('');

const committedText = (threadId: string): string =>
  rebuildThreadViewFromEvents(threadId)
    .events.filter(e => e.type === MODEL_TEXT_COMMITTED)
    .map(e => (e.payload as { text: string }).text)
    .join('');

const lastRunStatus = (target: {
  send: (channel: string, payload: unknown) => void;
}): string | undefined => {
  const calls = (target.send as ReturnType<typeof vi.fn>).mock.calls as Array<
    [string, { status?: string }]
  >;
  return calls
    .filter(call => call[0] === 'chat:run-status')
    .map(call => call[1]?.status)
    .at(-1);
};

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'iki-pi-tool-stream-'));
  initializeDatabase({ dbPath: path.join(root, 'tool-stream.db') });
  server = await createScriptedPiServer();
  addProvider({
    id: 'provider_pi_tool_stream',
    name: 'Pi tool stream provider',
    type: 'custom-openai',
    api_key: 'key-pi-tools',
    models: '["pi-model"]',
    base_url: `http://127.0.0.1:${server.port}/v1`,
    enabled: true,
  });
  addProvider({
    id: 'provider_sdk_tool_regress',
    name: 'Formerly SDK-pinned tool provider (now Pi-served)',
    type: 'deepseek',
    api_key: 'key-sdk',
    models: '["sdk-model"]',
    base_url: `http://127.0.0.1:${server.port}/v1`,
    enabled: true,
  });
  defaultToolRegistry.register(
    createTool({
      name: TOOL_NAME,
      type: 'fs',
      description: 'read a scenario file',
      paramSchema: z.object({ path: z.string() }),
      handler: async args => {
        executions.push(args.path);
        return `contents of ${args.path}`;
      },
    })
  );
  conversation = createChatPersistence({
    memory: {} as never,
  });
  conversation.createThread({ id: 'thread_pi_tool_stream' });
  conversation.createThread({ id: 'thread_sdk_tool_regress' });
});

afterAll(async () => {
  defaultToolRegistry.remove(TOOL_NAME);
  await server.close();
  closeDatabase();
  await fs.rm(root, { recursive: true, force: true });
});

describe('switch item 3a: never-approve tool turns on the Pi supply layer', () => {
  it('runs a real tool turn end to end through Pi — tool once, shown committed, run completed', async () => {
    server.setScriptSequence('read the tool probe file', [
      {
        chunks: [
          sse.delta('reading '),
          sse.toolCallDelta('call_pi_1', TOOL_NAME, '{"path":'),
          sse.toolCallDelta(null, null, '"/probe.txt"}'),
          sse.finish('tool_calls', { prompt_tokens: 30, completion_tokens: 10, total_tokens: 40 }),
        ],
      },
      {
        chunks: [
          sse.delta('the file says hi'),
          sse.finish('stop', {
            prompt_tokens: 100,
            completion_tokens: 20,
            total_tokens: 120,
            prompt_tokens_details: { cached_tokens: 60 },
            completion_tokens_details: { reasoning_tokens: 5 },
          }),
        ],
      },
    ]);

    const target = { id: 801, send: vi.fn() };
    const streaming = buildStreaming();

    const result = await streaming.stream(target, {
      providerType: 'custom-openai',
      providerId: 'provider_pi_tool_stream',
      model: 'pi-model',
      threadId: 'thread_pi_tool_stream',
      approvalPolicy: 'never',
      messages: [
        {
          id: 'msg_pi_tool',
          role: 'user',
          parts: [{ type: 'text', text: 'read the tool probe file' }],
        },
      ],
      tools: [TOOL_NAME],
    });
    expect(result).toMatchObject({ success: true });

    expect(executions).toEqual(['/probe.txt']);

    const toolCalls = chunksOf(target, 'tool-input-available');
    const toolResults = chunksOf(target, 'tool-output-available');
    expect(toolCalls[0]).toMatchObject({ toolName: TOOL_NAME, input: { path: '/probe.txt' } });
    expect((toolResults[0] as { output?: { type?: string; value?: string } }).output).toMatchObject(
      {
        type: 'text',
        value: 'contents of /probe.txt',
      }
    );

    const shown = publishedText(target);
    expect(shown).toBe('reading the file says hi');
    expect(committedText('thread_pi_tool_stream')).toBe(shown);

    expect(lastRunStatus(target)).toBe('completed');
    const usage = usageEvents.find(event => event.source === 'chat.stream');
    expect(usage?.usage).toMatchObject({ inputTokens: 130, cacheReadTokens: 60 });

    const secondWire = JSON.stringify(server.getWire('read the tool probe file', 1).messages);
    expect(secondWire).toContain('contents of /probe.txt');

    expect(server.countRequests('read the tool probe file')).toBe(2);
  }, 30000);

  it('exports the Pi tool observation into the trajectory', async () => {
    server.setScriptSequence('trajectory the probe file', [
      {
        chunks: [
          sse.toolCallDelta('call_traj_1', TOOL_NAME, '{"path":"/traj.txt"}'),
          sse.finish('tool_calls', { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }),
        ],
      },
      {
        chunks: [
          sse.delta('the file says hi'),
          sse.finish('stop', { prompt_tokens: 40, completion_tokens: 10, total_tokens: 50 }),
        ],
      },
    ]);

    const target = { id: 806, send: vi.fn() };
    const streaming = buildStreaming();
    const result = await streaming.stream(target, {
      providerType: 'custom-openai',
      providerId: 'provider_pi_tool_stream',
      model: 'pi-model',
      threadId: 'thread_pi_tool_stream',
      approvalPolicy: 'never',
      messages: [
        {
          id: 'msg_pi_traj',
          role: 'user',
          parts: [{ type: 'text', text: 'trajectory the probe file' }],
        },
      ],
      tools: [TOOL_NAME],
    });
    expect(result).toMatchObject({ success: true });
    expect(lastRunStatus(target)).toBe('completed');

    const run = agentRunDb
      .listAgentRunsByThread('thread_pi_tool_stream')
      .find(candidate => candidate.status === 'completed')!;
    const trajectory = exportRunTrajectory(run.id);
    expect(trajectory.success).toBe(true);
    expect(trajectory.trajectory).toBeDefined();

    const callStep = trajectory.trajectory!.steps.find(step =>
      step.tool_calls?.some(call => call.tool_call_id === 'call_traj_1')
    );
    expect(callStep, 'the tool call must be exported').toBeDefined();
    expect(callStep!.observation, 'the call must carry its observation').toBeDefined();
    expect(
      (callStep!.observation!.results as Array<{ source_call_id: string; content?: string }>).map(
        result => result.source_call_id
      )
    ).toContain('call_traj_1');
  }, 30000);

  it('full cycle: an always-policy turn pauses, the approval decides, the resume completes on Pi', async () => {
    const coordinator = createThreadStreamCoordinator();
    const chatApprovals = createChatApproval({
      streams: {
        tryAcquireThreadRun: coordinator.tryAcquireThreadRun,
        peek: coordinator.peekStream,
        attach: coordinator.attachStream,
        detach: coordinator.detachStream,
      },
      memory: {} as never,
      conversation: { upsertTurnMessage: () => undefined },
      usage: { recordUsageEvent: () => undefined },
    });

    server.setScriptSequence('guarded tool probe', [
      {
        chunks: [
          sse.toolCallDelta('call_guarded', TOOL_NAME, '{"path":'),
          sse.toolCallDelta(null, null, '"/guarded.txt"}'),
          sse.finish('tool_calls', { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }),
        ],
      },
      {
        chunks: [
          sse.delta('approved and done'),
          sse.finish('stop', { prompt_tokens: 50, completion_tokens: 10, total_tokens: 60 }),
        ],
      },
    ]);

    const executionsBefore = executions.length;
    const target = { id: 804, send: vi.fn() };
    const streaming = buildStreaming({
      ensurePendingApprovalSession: (approvalId, session) =>
        chatApprovals.ensurePendingApprovalSession(approvalId, session as never),
      registerApprovalBatch: (requests, session) =>
        chatApprovals.registerApprovalBatch(requests as never, session as never),
      cleanupPendingSessionsForSender: (senderId, sessionId) =>
        chatApprovals.cleanupPendingSessionsForSender(senderId, sessionId),
    });

    const first = await streaming.stream(target, {
      providerType: 'custom-openai',
      providerId: 'provider_pi_tool_stream',
      model: 'pi-model',
      threadId: 'thread_pi_tool_stream',
      approvalPolicy: 'always',
      messages: [
        {
          id: 'msg_pi_guarded',
          role: 'user',
          parts: [{ type: 'text', text: 'guarded tool probe' }],
        },
      ],
      tools: [TOOL_NAME],
    });

    expect(first).toMatchObject({ success: true, awaitingApproval: true });
    expect(executions.slice(executionsBefore)).toHaveLength(0);
    const approvalRequests = chunksOf(target, 'tool-approval-request') as Array<{
      approvalId?: string;
    }>;
    expect(approvalRequests[0]?.approvalId).toBeTruthy();
    expect(lastRunStatus(target)).toBe('blocked');
    expect(server.countRequests('guarded tool probe')).toBe(1);

    const decision = await chatApprovals.approveTool(
      target,
      approvalRequests[0]!.approvalId!,
      true,
      'integration approval'
    );
    expect(decision).toMatchObject({ success: true });

    expect(executions.slice(executionsBefore)).toEqual(['/guarded.txt']);
    expect(server.countRequests('guarded tool probe')).toBe(2);
    const secondWire = JSON.stringify(server.getWire('guarded tool probe', 1).messages);
    expect(secondWire).toContain('contents of /guarded.txt');
    expect(server.getWire('guarded tool probe', 0).max_completion_tokens).toBe(2000);
    expect(publishedText(target)).toContain('approved and done');
    expect(committedText('thread_pi_tool_stream')).toContain(publishedText(target));
  }, 40000);

  it('serves a formerly SDK-pinned provider through Pi under the same never policy', async () => {
    server.setScriptSequence('read the sdk probe file', [
      {
        chunks: [
          sse.toolCallDelta('call_sdk', TOOL_NAME, '{"path":'),
          sse.toolCallDelta(null, null, '"/sdk.txt"}'),
          sse.finish('tool_calls', { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }),
        ],
      },
      {
        chunks: [
          sse.delta('pi tool answer'),
          sse.finish('stop', { prompt_tokens: 20, completion_tokens: 8, total_tokens: 28 }),
        ],
      },
    ]);
    const requestsBefore = server.totalRequests();
    const executionsBefore = executions.length;

    const target = { id: 802, send: vi.fn() };
    const streaming = buildStreaming();

    const result = await streaming.stream(target, {
      providerType: 'deepseek',
      providerId: 'provider_sdk_tool_regress',
      model: 'sdk-model',
      threadId: 'thread_sdk_tool_regress',
      approvalPolicy: 'never',
      messages: [
        {
          id: 'msg_sdk_tool',
          role: 'user',
          parts: [{ type: 'text', text: 'read the sdk probe file' }],
        },
      ],
      tools: [TOOL_NAME],
    });
    expect(result).toMatchObject({ success: true });

    expect(executions.slice(executionsBefore)).toEqual(['/sdk.txt']);
    expect(publishedText(target)).toContain('pi tool answer');
    expect(lastRunStatus(target)).toBe('completed');
    expect(server.totalRequests()).toBe(requestsBefore + 2);
  }, 30000);

});
