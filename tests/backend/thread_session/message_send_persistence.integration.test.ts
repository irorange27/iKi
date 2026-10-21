import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const callPiChatMock = vi.hoisted(() => vi.fn());
const userDataMock = vi.hoisted(() => vi.fn(() => ''));

// The supply seam: Pi is the only executor (ADR 009). Scripting it here keeps
// these suites on the durable-layer behaviour they assert without reaching a
// network endpoint.
vi.mock('@iki/backend/provider/llm/pi_adapter', async importOriginal => ({
  ...(await importOriginal<typeof import('@iki/backend/provider/llm/pi_adapter')>()),
  callPiChat: callPiChatMock,
}));

vi.mock('@iki/backend/platform', () => ({ getUserDataPath: userDataMock }));
vi.mock('@iki/backend/provider/llm/factory', async importOriginal => ({
  ...(await importOriginal<typeof import('@iki/backend/provider/llm/factory')>()),
  resolvePersonaPrompt: () => 'persona prompt',
  getModelGenerationSettings: () => ({}),
  resolveModelCapability: async () => ({
    contextWindow: 100000,
    maxInputTokens: 98000,
    maxOutputTokens: 2000,
  }),
  // No database in this suite: answer the provider lookup directly so the Pi
  // supply admits the turn (the address is never dialled — callPiChat is mocked).
  getProviderConfig: () => ({
    type: 'openai',
    apiKey: 'key-test',
    baseURL: 'http://127.0.0.1:9/v1',
  }),
}));

import { closeDatabase, initializeDatabase } from '@iki/backend/db/database';
import { seedTurnProvider } from '../helpers/seed_turn_provider';
import * as approvalDb from '@iki/backend/db/tool_call_approval';
import * as agentRunDb from '@iki/backend/db/agent_runs';
import { getChatMessages } from '@iki/backend/db/chat_message';
import { addWorkspace } from '@iki/backend/db/workspaces';
import { createChatPersistence } from '@iki/backend/turn_prep/persistence';
import { createChatTurnPreparer } from '@iki/backend/turn_prep/turn_preparer';
import { resolveSkillsSystemPrompt } from '@iki/backend/thread_session/skills';
import {
  piTurnHarness,
  setTurnHarnessFallback,
} from '@iki/backend/thread_session/turn_supply_selection';
import {
  getAssistantProfileContextMessage,
  onMessagePersisted,
  retrieveRelevantContinuity,
} from '@iki/backend/thread_session/platform';
import { createMessageSend } from '@iki/backend/thread_session/message_send';
import { createChatApproval } from '@iki/backend/thread_session/approval';
import { createThreadStreamCoordinator } from '@iki/backend/thread_session/thread_stream_coordinator';
import { toModelInputMessages } from '@iki/backend/message/ui_messages';
import { parseStoredUiMessageRow } from '@iki/backend/message/ui_message_codec';
import { createScriptedPiChat } from '@iki/backend/agent/testing/scripted_pi';
import { getToolRuntimeContext } from '@iki/backend/utils/runtime_context';
import { createTool, defaultToolRegistry } from '@iki/backend/tools';

const memory = {
  onMessagePersisted: vi.fn(),
  injectMemoryIntoMessages: vi.fn((messages: unknown[]) => messages),
  getAffectContextMessage: () => '',
};

// F4 boundary: transport (stream vs send) must not decide which execution
// facts survive. A send that runs tools persists the same UI projection the
// streaming path persists, and a send that pauses on approval registers a
// durable, resumable decision handle instead of a bare error. F3 rides along:
// the send execution registers with the thread lease so a lease-loss barrier
// aborts it instead of letting it run to completion.
describe('message_send execution-fact persistence', () => {
  let root: string;
  let coordinator: ReturnType<typeof createThreadStreamCoordinator>;
  let approvals: ReturnType<typeof createChatApproval>;
  let conversation: ReturnType<typeof createChatPersistence>;

  const makeTurnPreparer = () =>
    createChatTurnPreparer({
      memory: memory as never,
      getRuntimeConfig: () => ({
        emotion: null,
        memoryContext: null,
        autoApproveToolRequests: false,
      }),
      resolveSkillsSystemPrompt,
      getAssistantProfileContextMessage,
      retrieveRelevantContinuity,
    });

  const makeSend = (deps: { tryAcquireThreadRun?: typeof coordinator.tryAcquireThreadRun } = {}) =>
    createMessageSend({
      turnPreparer: makeTurnPreparer(),
      usage: { recordUsageEvent: vi.fn() },
      tryAcquireThreadRun: deps.tryAcquireThreadRun ?? coordinator.tryAcquireThreadRun,
      checkThreadRunRate: () => ({ allowed: true }),
      conversation: conversation as never,
      approvals: {
        ensurePendingApprovalSession: approvals.ensurePendingApprovalSession,
        registerApprovalBatch: approvals.registerApprovalBatch,
      },
    }).send;

  const sendOptions = (overrides: Record<string, unknown> = {}) => ({
    providerType: 'openai',
    model: 'send-probe-model',
    threadId: 'thread_send',
    skillIds: [],
    skillMode: 'manual' as const,
    messages: [{ id: 'user_send_probe', role: 'user', content: 'probe' }],
    ...overrides,
  });

  beforeEach(async () => {
    // These suites drive the DURABLE layer (streaming, approvals, session-log
    // facts, retry, persistence) with a scripted AI SDK model. They are not about
    // which supply serves the turn, so they opt into the legacy executor: the
    // production default refuses a turn its projection cannot carry, and a
    // scripted model has no endpoint to project to.
    setTurnHarnessFallback(piTurnHarness);
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'iki-send-persistence-'));
    userDataMock.mockReturnValue(root);
    initializeDatabase({ dbPath: path.join(root, 'send.db') });
    // A resumed turn resolves its plan through the provider table; seed the row
    // it names so the Pi supply admits it (callPiChat is mocked).
    seedTurnProvider({
      providerId: 'provider_primary',
      providerType: 'openai',
      model: 'test-model',
    });
    addWorkspace({ id: 'ws_send', path: root, name: 'send' });
    coordinator = createThreadStreamCoordinator();
    memory.injectMemoryIntoMessages.mockClear();
    conversation = createChatPersistence({
      memory: memory as never,
      onContinuityMessagePersisted: onMessagePersisted,
    });
    conversation.createThread({ id: 'thread_send', workspace_id: 'ws_send' });
    approvals = createChatApproval({
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
  });

  afterEach(async () => {
    defaultToolRegistry.remove('send_probe');
    defaultToolRegistry.remove('send_approval_probe');
    closeDatabase();
    await fs.rm(root, { recursive: true, force: true });
  });

  it('persists tool exchanges from a send so the next context rebuild keeps them', async () => {
    defaultToolRegistry.register(
      createTool({
        name: 'send_probe',
        type: 'function',
        description: 'send projection probe',
        paramSchema: z.object({}),
        handler: async () => ({ evidence: 'observed' }),
      })
    );
    callPiChatMock.mockImplementation(
      createScriptedPiChat([
        [
          { kind: 'toolCall', toolName: 'send_probe', args: {}, id: 'read_1' },
          { kind: 'done', reason: 'toolUse' },
        ],
        [
          { kind: 'text', text: 'done answer' },
          { kind: 'done', reason: 'stop' },
        ],
      ])
    );

    const result = await makeSend()(
      sendOptions({ tools: ['send_probe'], approvalPolicy: 'never' })
    );

    expect(result).toMatchObject({ success: true, text: 'done answer' });
    const rows = getChatMessages('thread_send');
    const assistantRow = rows.find(row => row.id.startsWith('assistant_run_'));
    expect(assistantRow).toBeDefined();
    const parts = (JSON.parse(assistantRow!.message).parts ?? []) as Array<Record<string, unknown>>;
    expect(parts.some(part => part.type === 'dynamic-tool' && part.toolCallId === 'read_1')).toBe(
      true
    );
    expect(parts.some(part => part.type === 'text' && part.text === 'done answer')).toBe(true);

    // The real consumer of chat history — the next request's context rebuild —
    // must see the paired call/result.
    // Same envelope handling the recovery and send paths use.
    const uiMessages = rows.map(row =>
      parseStoredUiMessageRow({ id: row.id, message: row.message })
    );
    const next = await toModelInputMessages(uiMessages);
    const toolResults = next.flatMap(message =>
      (Array.isArray(message.content) ? message.content : []).filter(
        part => (part as { type?: string }).type === 'tool-result'
      )
    );
    expect(
      toolResults.some(part => (part as { toolCallId?: string }).toolCallId === 'read_1')
    ).toBe(true);
  });

  it('registers a durable approval handle a send can resume through approveTool', async () => {
    defaultToolRegistry.register(
      createTool({
        name: 'send_approval_probe',
        type: 'function',
        description: 'send approval probe',
        paramSchema: z.object({}),
        handler: async () => 'approved effect ran',
      })
    );
    // First call asks for the gated tool; the resumed turn answers.
    callPiChatMock.mockImplementation(
      createScriptedPiChat([
        [
          { kind: 'toolCall', toolName: 'send_approval_probe', args: {}, id: 'call_send_1' },
          { kind: 'done', reason: 'toolUse' },
        ],
        [
          { kind: 'text', text: 'approval resumed' },
          { kind: 'done', reason: 'stop' },
        ],
      ])
    );

    const result = await makeSend()(
      sendOptions({ tools: ['send_approval_probe'], approvalPolicy: 'always' })
    );

    expect(result).toMatchObject({ success: false, awaitingApproval: true });
    const run = agentRunDb.listAgentRunsByThread('thread_send').at(-1);
    expect(run?.status).toBe('blocked');

    const approvalId = run?.working.pendingApprovalIds[0];
    expect(approvalId).toBeTypeOf('string');
    expect(approvalDb.getToolCallApproval(approvalId!)).toMatchObject({ state: 'pending' });

    const target = { id: 77, send: vi.fn() };
    const resumed = await approvals.approveTool(target, approvalId!, true);
    expect(resumed).toMatchObject({ success: true });
    const finalRow = getChatMessages('thread_send').find(row =>
      row.id.startsWith('assistant_run_')
    );
    const finalParts = (JSON.parse(finalRow!.message).parts ?? []) as Array<
      Record<string, unknown>
    >;
    expect(
      finalParts.some(
        part =>
          part.type === 'dynamic-tool' &&
          part.toolCallId === 'call_send_1' &&
          part.state === 'output-available'
      )
    ).toBe(true);
    expect(finalParts.some(part => part.text === 'approval resumed')).toBe(true);
  });

  it('stops a send at the lease-loss barrier instead of running to completion', async () => {
    let notifyLeaseLost: (() => void) | undefined;
    const leaseCoordinator = createThreadStreamCoordinator({
      crossProcessThreadRun: (_threadId, options) => {
        notifyLeaseLost = options.onLeaseLost;
        return () => undefined;
      },
    });
    defaultToolRegistry.register(
      createTool({
        name: 'send_probe',
        type: 'function',
        description: 'lease loss probe',
        paramSchema: z.object({}),
        handler: async () => {
          // Park until the execution abort signal fires — on the old wiring
          // send has no signal at all and this promise never settles.
          const signal = getToolRuntimeContext().abortSignal;
          await new Promise<void>(resolve => {
            if (signal?.aborted) resolve();
            else signal?.addEventListener('abort', () => resolve());
          });
          return 'parked';
        },
      })
    );
    callPiChatMock.mockImplementation(
      createScriptedPiChat([
        [
          { kind: 'toolCall', toolName: 'send_probe', args: {}, id: 'call_park_1' },
          { kind: 'done', reason: 'toolUse' },
        ],
        [
          { kind: 'text', text: 'never reached' },
          { kind: 'done', reason: 'stop' },
        ],
      ])
    );

    const pending = makeSend({ tryAcquireThreadRun: leaseCoordinator.tryAcquireThreadRun })(
      sendOptions({ tools: ['send_probe'], approvalPolicy: 'never' })
    );
    // Give the turn time to reach the parked tool, then drop the lease.
    await new Promise(resolve => setTimeout(resolve, 50));
    notifyLeaseLost!();
    const result = await pending;

    expect(result).toMatchObject({ success: false });
    expect((result as { error?: string }).error).toContain('lease');
    const run = agentRunDb.listAgentRunsByThread('thread_send').at(-1);
    expect(run?.status).toBe('failed');
    expect(run?.error).toMatchObject({ code: 'THREAD_LEASE_LOST' });
  });
});
