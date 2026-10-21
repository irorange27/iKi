import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const external = vi.hoisted(() => ({
  userData: vi.fn(() => ''),
  model: vi.fn(),
  capability: vi.fn(),
}));
const callPiChatMock = vi.hoisted(() => vi.fn());

vi.mock('@iki/backend/provider/llm/pi_adapter', async importOriginal => ({
  ...(await importOriginal<typeof import('@iki/backend/provider/llm/pi_adapter')>()),
  callPiChat: callPiChatMock,
}));

vi.mock('@iki/backend/platform', () => ({ getUserDataPath: external.userData }));
vi.mock('@iki/backend/provider/llm/factory', async importOriginal => ({
  ...(await importOriginal<typeof import('@iki/backend/provider/llm/factory')>()),
  createModel: external.model,
  disposeLanguageModel: vi.fn(),
  resolvePersonaPrompt: () => 'review system',
  getModelGenerationSettings: () => ({}),
  resolveModelCapability: external.capability,
  getProviderConfig: () => ({
    type: 'openai',
    apiKey: 'key-test',
    baseURL: 'http://127.0.0.1:9/v1',
  }),
}));

import { closeDatabase, getDb, initializeDatabase } from '@iki/backend/db/database';
import { seedTurnProvider } from '../helpers/seed_turn_provider';
import {
  piTurnHarness,
  setTurnHarnessFallback,
} from '@iki/backend/thread_session/turn_supply_selection';
import { addWorkspace } from '@iki/backend/db/workspaces';
import { updateChatThread } from '@iki/backend/db/chat_thread';
import { tryAcquireCrossProcessThreadRun } from '@iki/backend/db/thread_run_locks';
import { createChatPersistence } from '@iki/backend/turn_prep/persistence';
import { createChatStreaming } from '@iki/backend/thread_session/session_loop';
import { createThreadStreamCoordinator } from '@iki/backend/thread_session/thread_stream_coordinator';
import { createChatTurnPreparer } from '@iki/backend/turn_prep/turn_preparer';
import { resolveSkillsSystemPrompt } from '@iki/backend/thread_session/skills';
import {
  getAssistantProfileContextMessage,
} from '@iki/backend/thread_session/platform';
import {
  assembleExecutionPlan,
  planToRunTrackerParams,
} from '@iki/backend/thread_session/execution_plan';
import { createAgentRunTracker } from '@iki/backend/thread_session/run_tracker';
import { getAgentRun } from '@iki/backend/db/agent_runs';
import {
  deriveResumeStreamOptions,
  rebuildResumeHistoryFromEvents,
} from '@iki/backend/thread_session/run_rehydrator';
import {
  INPUT_ACCEPTED,
  recordSessionEvents,
  SESSION_EVENT_VERSION,
} from '@iki/backend/thread_session/session_log';
import { createScriptedPiChat } from '@iki/backend/agent/testing/scripted_pi';
import { resolveThreadWorkspaceSelectionSnapshot } from '@iki/backend/workspaces/thread_workspace';
import { WriteFileTool } from '@iki/backend/tools/file_tools';
import { defaultToolRegistry } from '@iki/backend/tools';

const memory = {
  injectMemoryIntoMessages: vi.fn((messages: unknown[]) => messages),
  getAffectContextMessage: () => '',
};
const capacity = { contextWindow: 100000, maxInputTokens: 98000, maxOutputTokens: 2000 };

describe('execution plan admission boundaries', () => {
  let root: string;
  let conversation: ReturnType<typeof createChatPersistence>;
  let coordinator: ReturnType<typeof createThreadStreamCoordinator>;
  let streaming: ReturnType<typeof createChatStreaming>;
  let releases: Array<() => void>;

  beforeEach(async () => {
    setTurnHarnessFallback(piTurnHarness);
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'iki-plan-boundaries-'));
    external.userData.mockReturnValue(root);
    initializeDatabase({ dbPath: path.join(root, 'boundaries.db') });
    seedTurnProvider({ providerId: 'provider_primary', providerType: 'openai', model: 'test-model' });
    releases = [];
    external.capability.mockReset();
    external.capability.mockResolvedValue(capacity);
    const a = path.join(root, 'a');
    const b = path.join(root, 'b');
    await fs.mkdir(a);
    await fs.mkdir(b);
    await fs.writeFile(path.join(a, 'AGENTS.md'), 'SCOPE_MARKER_A');
    await fs.writeFile(path.join(b, 'AGENTS.md'), 'SCOPE_MARKER_B');
    addWorkspace({ id: 'workspace_bound_a', path: a, name: 'A' });
    addWorkspace({ id: 'workspace_wt_bound_b', path: b, name: 'B' });
    conversation = createChatPersistence({
      memory: memory as never,
    });
    conversation.createThread({
      id: 'thread_bound',
      workspace_id: 'workspace_bound_a',
      metadata: '{"mode":"work"}',
    });
    defaultToolRegistry.register(new WriteFileTool().toAgentTool());
    callPiChatMock.mockImplementation(
      createScriptedPiChat([
        [
          { kind: 'toolCall', toolName: 'write_file', args: { path: 'effect.txt', content: 'bound' }, id: 'call_bound' },
          { kind: 'done', reason: 'toolUse' },
        ],
        [{ kind: 'text', text: 'done' }, { kind: 'done', reason: 'stop' }],
      ])
    );
    coordinator = createThreadStreamCoordinator({
      crossProcessThreadRun: (threadId, options) => {
        const release = tryAcquireCrossProcessThreadRun(threadId, {
          onLeaseLost: options.onLeaseLost,
        });
        if (release) releases.push(release);
        return release;
      },
    });
    streaming = createChatStreaming({
      streamCoordinator: coordinator,
      memory: memory as never,
      conversation: conversation as never,
      usage: { recordUsageEvent: vi.fn() },
      approvals: {
        ensurePendingApprovalSession: vi.fn(),
        registerApprovalBatch: vi.fn(),
        cleanupPendingSessionsForSender: vi.fn(),
      },
      getThreadTitle: () => 'Boundaries',
    });
  });

  afterEach(async () => {
    for (const release of releases) release();
    defaultToolRegistry.remove('write_file');
    closeDatabase();
    await fs.rm(root, { recursive: true, force: true });
  });

  const options = () => ({
    providerType: 'openai',
    model: 'boundaries-model',
    threadId: 'thread_bound',
    approvalPolicy: 'never' as const,
    tools: ['write_file'],
    messages: [{ id: 'msg_bound', role: 'user' as const, content: 'write the file' }],
  });

  it('keeps reasoning effort and autonomy in the run-row recovery path (R3)', async () => {
    const preparer = createChatTurnPreparer({
      memory: memory as never,
      getRuntimeConfig: () => ({
        emotion: null,
        memoryContext: null,
        autoApproveToolRequests: false,
      }),
      resolveSkillsSystemPrompt,
      getAssistantProfileContextMessage,
    });
    const original = {
      ...options(),
      reasoningEffort: 'high',
      autonomous: { maxIterations: 3, continuePrompt: 'keep going' },
    };
    const prepared = await preparer.prepareChatTurn(original);
    const plan = assembleExecutionPlan({
      options: original,
      preparedTurn: prepared,
      transport: 'stream',
      workspaceSelection: null,
    });
    const tracker = createAgentRunTracker(
      planToRunTrackerParams(plan, {
        input: { messages: prepared.finalMessages },
        working: {
          modelMessages: prepared.history,
          accumulatedText: '',
          pendingApprovalIds: [],
          lastStepIndex: 0,
        },
      })
    );
    const stored = getAgentRun(tracker.id);
    expect(stored).not.toBeNull();
    if (!stored) throw new Error('Missing recorded run');
    const recovered = deriveResumeStreamOptions(stored, { kind: 'chat-turn' });
    expect(recovered).toMatchObject({
      reasoningEffort: 'high',
      autonomous: { maxIterations: 3, continuePrompt: 'keep going' },
    });
  });

  it('binds the provider context to the admission workspace, not the switched one (R1)', async () => {
    let releaseCapability!: () => void;
    const capabilityHeld = new Promise<void>(done => {
      releaseCapability = done;
    });
    let capabilityEntered = false;
    external.capability.mockImplementationOnce(async () => {
      capabilityEntered = true;
      await capabilityHeld;
      return capacity;
    });

    const doStream = callPiChatMock;
    const turn = streaming.stream({ id: 601, send: vi.fn() }, options());
    await vi.waitFor(() => expect(capabilityEntered).toBe(true));
    conversation.updateThread('thread_bound', { workspace_id: 'workspace_wt_bound_b' });
    releaseCapability();

    expect(await turn).toMatchObject({ success: true });

    const a = path.join(root, 'a');
    const b = path.join(root, 'b');
    expect(await fs.readFile(path.join(a, 'effect.txt'), 'utf8')).toBe('bound');
    await expect(fs.stat(path.join(b, 'effect.txt'))).rejects.toThrow();

    expect(doStream).toHaveBeenCalled();
    const request = doStream.mock.calls[0]?.[1];
    const prompt = JSON.stringify(request);
    expect(prompt).toContain('SCOPE_MARKER_A');
    expect(prompt).toContain(`Current workspace: A (${path.join(root, 'a')})`);
    expect(prompt).not.toContain('SCOPE_MARKER_B');
    expect(prompt).not.toContain(`Current workspace: B`);
    expect(prompt).not.toContain(`(${path.join(root, 'b')})`);
  });

  it.each(['stream', 'send'] as const)(
    'releases the admission when world resolution fails in %s (R2)',
    async mode => {
      updateChatThread('thread_bound', { workspace_id: null });
      await fs.writeFile(path.join(root, 'thread-workspaces'), 'not a directory');

      const attempt =
        mode === 'stream'
          ? streaming.stream({ id: 602, send: vi.fn() }, options())
          : streaming.send(options());
      const settled = await attempt.then(
        value => ({ value }),
        reason => ({ unhandled: reason })
      );
      const failure = 'unhandled' in settled ? settled.unhandled : settled.value;
      const failureText =
        failure instanceof Error
          ? failure.message
          : String((failure as { error?: string })?.error ?? failure);
      expect(failureText).toContain('ENOTDIR');

      const recoveredAdmission = coordinator.tryAcquireThreadRun('thread_bound');
      if (recoveredAdmission) recoveredAdmission();
      expect(recoveredAdmission).not.toBeNull();
      expect(getDb().prepare('SELECT * FROM thread_run_locks').all()).toHaveLength(0);
    }
  );

  it('rebinds the original turn world when retrying from the run row (D30 follow-up)', async () => {
    const preparer = createChatTurnPreparer({
      memory: memory as never,
      getRuntimeConfig: () => ({
        emotion: null,
        memoryContext: null,
        autoApproveToolRequests: false,
      }),
      resolveSkillsSystemPrompt,
      getAssistantProfileContextMessage,
    });
    const original = options();
    const prepared = await preparer.prepareChatTurn(original);
    const plan = assembleExecutionPlan({
      options: original,
      preparedTurn: prepared,
      transport: 'stream',
      workspaceSelection: resolveThreadWorkspaceSelectionSnapshot('thread_bound'),
    });
    const tracker = createAgentRunTracker(
      planToRunTrackerParams(plan, {
        input: { messages: prepared.finalMessages },
        working: {
          modelMessages: prepared.history,
          accumulatedText: '',
          pendingApprovalIds: [],
          lastStepIndex: 0,
        },
      })
    );
    const stored = getAgentRun(tracker.id);
    if (!stored) throw new Error('Missing recorded run');

    recordSessionEvents('thread_bound', [
      {
        type: INPUT_ACCEPTED,
        version: SESSION_EVENT_VERSION,
        payload: {
          messageId: 'msg_bound',
          message: {
            id: 'msg_bound',
            role: 'user',
            parts: [{ type: 'text', text: 'write the file' }],
          } as never,
        },
      },
    ]);

    conversation.updateThread('thread_bound', { workspace_id: 'workspace_wt_bound_b' });
    const recovered = await rebuildResumeHistoryFromEvents('thread_bound', stored.id);
    const resumedOptions = deriveResumeStreamOptions(stored, {
      kind: 'chat-turn',
      ...(recovered
        ? { inputMessages: recovered.history, systemPrompts: recovered.systemPrompts }
        : {}),
    });
    expect(resumedOptions.workspaceSelection).toMatchObject({ workspaceId: 'workspace_bound_a' });

    const doStream = callPiChatMock;
    const turn = streaming.stream(
      { id: 603, send: vi.fn() },
      {
        ...resumedOptions,
        approvalPolicy: 'never',
      }
    );
    expect(await turn).toMatchObject({ success: true });

    expect(await fs.readFile(path.join(root, 'a', 'effect.txt'), 'utf8')).toBe('bound');
    await expect(fs.stat(path.join(root, 'b', 'effect.txt'))).rejects.toThrow();
    const request = doStream.mock.calls[0]?.[1];
    const prompt = JSON.stringify(request);
    expect(prompt).toContain(`Current workspace: A (${path.join(root, 'a')})`);
    expect(prompt).not.toContain('Current workspace: B');
  });

  it('renders an explicit null world as no-workspace, not a fresh resolution', async () => {
    const preparer = createChatTurnPreparer({
      memory: memory as never,
      getRuntimeConfig: () => ({
        emotion: null,
        memoryContext: null,
        autoApproveToolRequests: false,
      }),
      resolveSkillsSystemPrompt,
      getAssistantProfileContextMessage,
    });
    const prepared = await preparer.prepareChatTurn({
      ...options(),
      workspaceSelection: null,
    });
    const prompt = JSON.stringify(prepared.finalMessages);
    expect(prompt).toContain('No workspace is selected');
    expect(prompt).not.toContain('workspace_bound_a');
  });
});
