import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const createModelMock = vi.hoisted(() => vi.fn());
const prepareChatTurnMock = vi.hoisted(() => vi.fn());

vi.mock('@iki/backend/provider/llm/factory', async importOriginal => {
  const actual = await importOriginal<typeof import('@iki/backend/provider/llm/factory')>();
  return {
    ...actual,
    createModel: createModelMock,
    disposeLanguageModel: vi.fn(),
    resolvePersonaPrompt: vi.fn(() => 'persona prompt'),
    getModelGenerationSettings: vi.fn(() => ({})),
    resolveModelCapability: async () => ({
      contextWindow: 100000,
      maxInputTokens: 98000,
      maxOutputTokens: 2000,
    }),
  };
});

vi.mock('@iki/backend/turn_prep/turn_preparer', () => ({
  createChatTurnPreparer: () => ({
    prepareChatTurn: prepareChatTurnMock,
  }),
}));

vi.mock('@iki/backend/thread_session/platform', () => ({
  // session_loop now consumes these three as named imports; the factory must
  // provide them or module linking fails even when the preparer is mocked out.
  getAssistantProfileContextMessage: () => '',
  retrieveRelevantContinuity: () => null,
  onMessagePersisted: async () => undefined,
  getCompanion: () => ({
    setChatPolicy: vi.fn(),
    setAffect: vi.fn(),
    beginThinking: vi.fn(),
    endThinking: vi.fn(),
    clearConversationPreview: vi.fn(),
    setConversationPreview: vi.fn(),
    notifyReplyComplete: vi.fn(),
  }),
}));

import { closeDatabase, initializeDatabase } from '@iki/backend/db/database';
import { addWorkspace } from '@iki/backend/db/workspaces';
import { getChatThread } from '@iki/backend/db/chat_thread';
import { createChatPersistence } from '@iki/backend/turn_prep/persistence';
import { createChatStreaming } from '@iki/backend/thread_session/session_loop';
import { createThreadStreamCoordinator } from '@iki/backend/thread_session/thread_stream_coordinator';
import { FauxModelProvider, fauxText, fauxToolCall } from '@iki/backend/agent/testing/faux_model';
import { WriteFileTool } from '@iki/backend/tools/file_tools';
import { defaultToolRegistry } from '@iki/backend/tools';

const memory = {
  onMessagePersisted: vi.fn(),
  injectMemoryIntoMessages: vi.fn((messages: unknown[]) => messages),
  getAffectContextMessage: () => '',
};

// D30 boundary: the turn keeps the workspace it STARTED in. A workspace
// switch that lands while the turn is still preparing must not redirect this
// turn's tools — preparation awaits (memory retrieval, context assembly) are
// exactly where a user switch races the binding. The binding must therefore
// be snapshotted at admission, before the first preparation await.
describe('stream binds the turn workspace at admission', () => {
  let root: string;
  let conversation: ReturnType<typeof createChatPersistence>;
  const preparedTurn = {
    report: { totalEstimatedTokens: 1, blocks: [] },
    usedSkills: [],
    selectedSkillIds: [],
    skillMode: 'manual' as const,
    finalMessages: [{ role: 'user' as const, content: 'write the file' }],
    history: [] as unknown[],
    prompt: 'write the file',
    guardActive: false,
    requireApproval: false,
    autoApproveToolRequests: false,
    affectSignal: null,
    interventionPolicy: null,
    guardedTools: ['write_file'],
    enableTools: true,
  };

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'iki-turn-start-workspace-'));
    initializeDatabase({ dbPath: path.join(root, 'binding.db') });
    const a = path.join(root, 'a');
    const b = path.join(root, 'b');
    await fs.mkdir(a);
    await fs.mkdir(b);
    addWorkspace({ id: 'workspace_a', path: a, name: 'a' });
    addWorkspace({ id: 'workspace_wt_binding', path: b, name: 'b' });
    conversation = createChatPersistence({
      memory: memory as never,
      // platform is module-mocked above; the real continuity hook is not
      // under test here, so the port gets a no-op double.
      onContinuityMessagePersisted: async () => undefined,
    });
    conversation.createThread({
      id: 'thread_binding',
      workspace_id: 'workspace_a',
      metadata: '{"mode":"work"}',
    });
    defaultToolRegistry.register(new WriteFileTool().toAgentTool());
    createModelMock.mockReturnValue(
      new FauxModelProvider([
        fauxToolCall('write_file', { path: 'binding.txt', content: 'binding' }, { id: 'call_binding' }),
        fauxText('done'),
      ])
    );
    prepareChatTurnMock.mockResolvedValue(preparedTurn);
  });

  afterEach(async () => {
    defaultToolRegistry.remove('write_file');
    closeDatabase();
    await fs.rm(root, { recursive: true, force: true });
  });

  it('keeps the admission-time workspace when the thread switches during preparation', async () => {
    const streaming = createChatStreaming({
      streamCoordinator: createThreadStreamCoordinator(),
      memory: memory as never,
      conversation: conversation as never,
      usage: { recordUsageEvent: vi.fn() },
      approvals: {
        ensurePendingApprovalSession: vi.fn(),
        registerApprovalBatch: vi.fn(),
        cleanupPendingSessionsForSender: vi.fn(),
      },
      getThreadTitle: () => 'Thread',
    });

    const a = path.join(root, 'a');
    const b = path.join(root, 'b');

    // Hold preparation open so the workspace switch lands mid-turn, before
    // the harness ever runs.
    let release!: () => void;
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });
    prepareChatTurnMock.mockImplementationOnce(async () => {
      await gate;
      return preparedTurn;
    });

    const turn = streaming.stream({ id: 71, send: vi.fn() }, {
      providerType: 'openai',
      providerId: 'provider_primary',
      model: 'test-model',
      threadId: 'thread_binding',
      approvalPolicy: 'never',
      messages: [{ id: 'msg_binding', role: 'user', content: 'write the file' }],
      tools: ['write_file'],
    });
    await vi.waitFor(() => expect(prepareChatTurnMock).toHaveBeenCalled());

    conversation.updateThread('thread_binding', { workspace_id: 'workspace_wt_binding' });
    expect(getChatThread('thread_binding')?.workspace_id).toBe('workspace_wt_binding');

    release();
    expect(await turn).toMatchObject({ success: true });

    // The write executed where the turn started — not where the thread points
    // now. The next turn (and the UI) see the new selection; this turn does not.
    expect(await fs.readFile(path.join(a, 'binding.txt'), 'utf8')).toBe('binding');
    await expect(fs.stat(path.join(b, 'binding.txt'))).rejects.toThrow();
  });
});
