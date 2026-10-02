import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const external = vi.hoisted(() => ({
  userData: vi.fn(() => ''),
  model: vi.fn(),
  capability: vi.fn(),
}));
vi.mock('@iki/backend/platform', () => ({ getUserDataPath: external.userData }));
vi.mock('@iki/backend/provider/llm/factory', async importOriginal => ({
  ...(await importOriginal<typeof import('@iki/backend/provider/llm/factory')>()),
  createModel: external.model,
  disposeLanguageModel: vi.fn(),
  getFullSystemPrompt: () => 'review system',
  getModelGenerationSettings: () => ({}),
  resolveModelCapability: external.capability,
}));

import { closeDatabase, getDb, initializeDatabase } from '@iki/backend/db/database';
import { addWorkspace } from '@iki/backend/db/workspaces';
import { updateChatThread } from '@iki/backend/db/chat_thread';
import { tryAcquireCrossProcessThreadRun } from '@iki/backend/db/thread_run_locks';
import { createChatPersistence } from '@iki/backend/turn_prep/persistence';
import { createChatStreaming } from '@iki/backend/thread_session/session_loop';
import { createThreadStreamCoordinator } from '@iki/backend/thread_session/thread_stream_coordinator';
import { createChatTurnPreparer } from '@iki/backend/turn_prep/turn_preparer';
import {
  assembleExecutionPlan,
  planToRunTrackerParams,
} from '@iki/backend/thread_session/execution_plan';
import { createAgentRunTracker } from '@iki/backend/thread_session/run_tracker';
import { getAgentRun } from '@iki/backend/db/agent_runs';
import { deriveResumeStreamOptions } from '@iki/backend/thread_session/run_rehydrator';
import { FauxModelProvider, fauxText, fauxToolCall } from '@iki/backend/agent/testing/faux_model';
import { WriteFileTool } from '@iki/backend/tools/file_tools';
import { defaultToolRegistry } from '@iki/backend/tools';

const memory = {
  onMessagePersisted: vi.fn(),
  injectMemoryIntoMessages: vi.fn((messages: unknown[]) => messages),
  getAffectContextMessage: () => '',
};
const capacity = { contextWindow: 100000, maxInputTokens: 98000, maxOutputTokens: 2000 };

// Review follow-ups (issue #72): the plan's admission-frozen world must bind
// every consumer — the provider context projection (R1), not just tools and
// approvals; a failing world resolution must release the admission instead of
// stranding the thread (R2); and the run-row recovery path must restore the
// execution configuration instead of silently dropping fields (R3). Real
// preparer, SDK, SQLite, coordinator and file tools throughout — the stock
// stream regression mocked the preparer and could not see R1.
describe('execution plan admission boundaries', () => {
  let root: string;
  let conversation: ReturnType<typeof createChatPersistence>;
  let coordinator: ReturnType<typeof createThreadStreamCoordinator>;
  let streaming: ReturnType<typeof createChatStreaming>;
  let model: FauxModelProvider;
  let releases: Array<() => void>;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'iki-plan-boundaries-'));
    external.userData.mockReturnValue(root);
    initializeDatabase({ dbPath: path.join(root, 'boundaries.db') });
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
    conversation = createChatPersistence({ memory: memory as never });
    conversation.createThread({
      id: 'thread_bound',
      workspace_id: 'workspace_bound_a',
      metadata: '{"mode":"work"}',
    });
    defaultToolRegistry.register(new WriteFileTool().toAgentTool());
    model = new FauxModelProvider([
      fauxToolCall('write_file', { path: 'effect.txt', content: 'bound' }, { id: 'call_bound' }),
      fauxText('done'),
    ]);
    external.model.mockReturnValue(model);
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
    // Hold the REAL preparer inside its model-capability await, switch the
    // thread's workspace, then release — the classic preparation race.
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

    const doStream = vi.spyOn(model, 'doStream');
    const turn = streaming.stream({ id: 601, send: vi.fn() }, options());
    await vi.waitFor(() => expect(capabilityEntered).toBe(true));
    conversation.updateThread('thread_bound', { workspace_id: 'workspace_wt_bound_b' });
    releaseCapability();

    expect(await turn).toMatchObject({ success: true });

    // Tools executed where the turn started (the admission-freeze contract).
    const a = path.join(root, 'a');
    const b = path.join(root, 'b');
    expect(await fs.readFile(path.join(a, 'effect.txt'), 'utf8')).toBe('bound');
    await expect(fs.stat(path.join(b, 'effect.txt'))).rejects.toThrow();

    // The provider saw the SAME world: A's project instructions and workspace
    // identity, never B's — the model must not reason under rules of a
    // workspace its tools do not run in.
    expect(doStream).toHaveBeenCalled();
    const request = doStream.mock.calls[0]?.[0] as { prompt?: unknown } | undefined;
    const prompt = JSON.stringify(request?.prompt);
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
      // A plain file where the work-mode scratch directory would be created:
      // the admission-time resolution throws ENOTDIR for real.
      await fs.writeFile(path.join(root, 'thread-workspaces'), 'not a directory');

      const attempt =
        mode === 'stream'
          ? streaming.stream({ id: 602, send: vi.fn() }, options())
          : streaming.send(options());
      // The entry must settle (not leave an unhandled rejection) with a
      // failure result.
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

      // The admission is re-acquirable and the SQLite lease is gone — the
      // thread is not stranded for the life of the service instance.
      const recoveredAdmission = coordinator.tryAcquireThreadRun('thread_bound');
      if (recoveredAdmission) recoveredAdmission();
      expect(recoveredAdmission).not.toBeNull();
      expect(getDb().prepare('SELECT * FROM thread_run_locks').all()).toHaveLength(0);
    }
  );

  it('renders an explicit null world as no-workspace, not a fresh resolution', async () => {
    const preparer = createChatTurnPreparer({
      memory: memory as never,
      getRuntimeConfig: () => ({
        emotion: null,
        memoryContext: null,
        autoApproveToolRequests: false,
      }),
    });
    const prepared = await preparer.prepareChatTurn({
      ...options(),
      // Explicit null: the caller froze "no workspace" at admission — the
      // context must not silently re-resolve to the thread's current A.
      workspaceSelection: null,
    });
    const prompt = JSON.stringify(prepared.finalMessages);
    expect(prompt).toContain('No workspace is selected');
    expect(prompt).not.toContain('workspace_bound_a');
  });
});
