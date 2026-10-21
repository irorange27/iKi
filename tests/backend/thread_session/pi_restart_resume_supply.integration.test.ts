// @vitest-environment node

/**
 * Issue #133: a RESTART-recovered resume of a Pi-paused turn must resume on
 * the Pi supply. The session-log replay stamps the pending approval onto the
 * assistant partial; before the fix that part failed the Pi projection and
 * the resumed segment flipped to the AI SDK harness (the supply flip
 * documented at the ADR 008 F2 review). Now piDomainResumeHistory strips the
 * pairing stamps to the Pi wire domain and the decided call executes through
 * the five-state owner's resumeCommands flow — exactly as the live path
 * does. Proven at the real consumer boundary (approveTool restart recovery,
 * real projection, real owner, real tool):
 *   - the resumed segment runs the Pi harness (createModel is never called);
 *   - the decided call executes exactly once;
 *   - the resumed wire carries the paused tool call + exactly one tool
 *     result and no approval part anywhere.
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { AssistantMessage, Message as PiMessage } from '@earendil-works/pi-ai';

const callPiChatMock = vi.hoisted(() => vi.fn());

vi.mock('@iki/backend/provider/llm/factory', async importOriginal => ({
  ...(await importOriginal<typeof import('@iki/backend/provider/llm/factory')>()),
  resolvePersonaPrompt: () => 'audit system',
  getModelGenerationSettings: () => ({}),
  resolveModelCapability: async () => ({
    contextWindow: 100000,
    maxInputTokens: 98000,
    maxOutputTokens: 2000,
  }),
}));

// Only the transport is mocked; projectHistoryToPiContext (the domain gate
// this unit is about) stays real.
vi.mock('@iki/backend/provider/llm/pi_adapter', async importOriginal => ({
  ...(await importOriginal<typeof import('@iki/backend/provider/llm/pi_adapter')>()),
  callPiChat: callPiChatMock,
}));

import { closeDatabase, initializeDatabase, getDb } from '@iki/backend/db/database';
import { addWorkspace } from '@iki/backend/db/workspaces';
import { addProvider } from '@iki/backend/db/providers';
import { getSessionEvents } from '@iki/backend/db/session_events';
import { createChatPersistence } from '@iki/backend/turn_prep/persistence';
import { onMessagePersisted } from '@iki/backend/thread_session/platform';
import { createChatApproval } from '@iki/backend/thread_session/approval';
import { createChatStreaming } from '@iki/backend/thread_session/session_loop';
import { createThreadStreamCoordinator } from '@iki/backend/thread_session/thread_stream_coordinator';
import { rebuildThreadViewFromEvents } from '@iki/backend/thread_session/session_log';
import { TOOL_EXECUTION_FINISHED } from '@iki/backend/thread_session/tool_execution';
import { createTool, defaultToolRegistry } from '@iki/backend/tools';

const TOOL_NAME = 'pi_supply_probe';
const executions: string[] = [];

type PiStep = { content: AssistantMessage['content']; deltas?: string[]; stopReason?: AssistantMessage['stopReason'] };
let piScript: PiStep[] = [];

const scriptPiResponse = (): AsyncGenerator<{ type: 'text_delta'; delta: string }> & {
  result: () => Promise<AssistantMessage>;
} => {
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
    stopReason: step.stopReason ?? 'stop',
    timestamp: Date.now(),
  };
  const iter = (async function* () {
    for (const delta of step.deltas ?? []) yield { type: 'text_delta' as const, delta };
  })();
  return Object.assign(iter, { result: async () => final });
};

const memory = {
  onMessagePersisted: vi.fn(),
  injectMemoryIntoMessages: vi.fn((messages: unknown[]) => messages),
  getAffectContextMessage: () => '',
};

describe('a restart-recovered resume of a Pi-paused turn stays on the Pi supply', () => {
  let dataDir = '';
  let conversation: ReturnType<typeof createChatPersistence>;
  let coordinator: ReturnType<typeof createThreadStreamCoordinator>;

  const buildApprovals = () =>
    createChatApproval({
      streams: {
        tryAcquireThreadRun: coordinator.tryAcquireThreadRun,
        peek: coordinator.peekStream,
        attach: coordinator.attachStream,
        detach: coordinator.detachStream,
      },
      memory: memory as never,
      conversation: conversation as never,
      usage: { recordUsageEvent: vi.fn() },
    });

  const buildStreaming = (approvals: ReturnType<typeof createChatApproval>) =>
    createChatStreaming({
      streamCoordinator: coordinator,
      memory: memory as never,
      conversation: conversation as never,
      usage: { recordUsageEvent: vi.fn() },
      approvals: {
        ensurePendingApprovalSession: approvals.ensurePendingApprovalSession,
        registerApprovalBatch: approvals.registerApprovalBatch,
        cleanupPendingSessionsForSender: approvals.cleanupPendingSessionsForSender,
      },
      getThreadTitle: () => 'Supply',
    });

  const pauseOnProbe = async (
    streaming: ReturnType<typeof createChatStreaming>,
    targetId: number
  ) => {
    piScript = [
      {
        content: [
          { type: 'toolCall', id: 'call_supply', name: TOOL_NAME, arguments: { path: '/supply.txt' } },
        ],
        stopReason: 'toolUse',
      },
    ];
    const pauseResult = await streaming.stream({ id: targetId, send: vi.fn() }, {
      providerType: 'custom-openai',
      providerId: 'provider_pi_supply',
      model: 'pi-model',
      threadId: 'thread_pi_supply',
      approvalPolicy: 'always',
      messages: [
        {
          id: `msg_supply_${targetId}`,
          role: 'user',
          parts: [{ type: 'text', text: 'probe it' }],
        },
      ],
      tools: [TOOL_NAME],
    });
    expect(pauseResult).toMatchObject({ success: true, awaitingApproval: true });
    const pausedView = rebuildThreadViewFromEvents('thread_pi_supply');
    return pausedView.approvals.at(-1)!.approvalId;
  };

  beforeAll(async () => {
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'iki-pi-restart-resume-'));
    const workspaceDir = path.join(dataDir, 'ws');
    await fs.mkdir(workspaceDir, { recursive: true });
    initializeDatabase({ dbPath: path.join(dataDir, 'supply.db') });
    addWorkspace({ id: 'workspace_supply', path: workspaceDir, name: 'supply' });
    addProvider({
      id: 'provider_pi_supply',
      name: 'Pi supply provider',
      type: 'custom-openai',
      api_key: 'key-pi',
      models: '["pi-model"]',
      base_url: 'http://127.0.0.1:9/v1',
      enabled: true,
    });
    conversation = createChatPersistence({
      memory: memory as never,
      onContinuityMessagePersisted: onMessagePersisted,
    });
    conversation.createThread({
      id: 'thread_pi_supply',
      workspace_id: 'workspace_supply',
      metadata: '{"mode":"work"}',
    });
    defaultToolRegistry.register(
      createTool({
        name: TOOL_NAME,
        type: 'fs',
        description: 'supply probe',
        paramSchema: z.object({ path: z.string() }),
        handler: async args => {
          executions.push(args.path);
          return `probe ok ${args.path}`;
        },
      })
    );
  });

  afterAll(async () => {
    defaultToolRegistry.remove(TOOL_NAME);
    closeDatabase();
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    vi.clearAllMocks();
    executions.length = 0;
    piScript = [];
    memory.injectMemoryIntoMessages.mockClear();
    memory.injectMemoryIntoMessages.mockImplementation((messages: unknown[]) => messages);
    callPiChatMock.mockImplementation(scriptPiResponse);
    coordinator = createThreadStreamCoordinator();
  });

  it('resumes on the Pi harness, executes the decided call exactly once, and wires no duplicate result', async () => {
    const approvalsA = buildApprovals();
    const approvalId = await pauseOnProbe(buildStreaming(approvalsA), 161);
    // The pause itself ran Pi: one scripted transport call, no AI SDK model.
    expect(callPiChatMock).toHaveBeenCalledTimes(1);

    // A restart: fresh approvals registry, and both old projections are gone.
    const approvalsB = buildApprovals();
    getDb().exec('DELETE FROM agent_runs');
    getDb().exec('DELETE FROM chat_messages');

    piScript = [{ content: [{ type: 'text', text: 'resumed on pi' }], deltas: ['resumed ', 'on pi'] }];
    const chunks: string[] = [];
    const result = await approvalsB.approveTool(
      {
        id: 162,
        send: (channel, value) => {
          const chunk = value as { type?: string };
          if (channel === 'chat:ui-chunk') chunks.push(chunk.type ?? '');
        },
      },
      approvalId,
      true
    );

    expect(result).toMatchObject({
      success: true,
      awaitingApproval: false,
      threadId: 'thread_pi_supply',
      text: 'resumed on pi',
    });
    expect(chunks).toContain('finish');
    // The supply did not flip mid-turn: the resumed segment never built an
    // AI SDK model.

    // The decided call executed exactly once through the five-state owner.
    expect(executions).toEqual(['/supply.txt']);
    expect(
      getSessionEvents('thread_pi_supply', [TOOL_EXECUTION_FINISHED])
    ).toHaveLength(1);

    // The resumed wire carries the paused call (stamps stripped) and exactly
    // one appended tool result — no duplicated result, no approval part.
    const resumedRequest = callPiChatMock.mock.calls.at(-1)![1] as { messages: PiMessage[] };
    const wireText = JSON.stringify(resumedRequest.messages);
    expect(wireText).toContain('call_supply');
    expect(resumedRequest.messages.filter(message => message.role === 'toolResult')).toHaveLength(1);
    expect(wireText).not.toContain('approval');

    // The replay tells the whole story: decision, completed continuation.
    const view = rebuildThreadViewFromEvents('thread_pi_supply');
    expect(view.approvals.find(approval => approval.approvalId === approvalId)).toMatchObject({
      status: 'approved',
    });
    expect(view.turns.some(turn => turn.status === 'completed')).toBe(true);
    expect(JSON.stringify(view.messages)).toContain('resumed on pi');
  });
});
