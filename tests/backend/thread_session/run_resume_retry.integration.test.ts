import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const createModelMock = vi.hoisted(() => vi.fn());
const userDataMock = vi.hoisted(() => vi.fn(() => ''));

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
}));

import { closeDatabase, initializeDatabase } from '@iki/backend/db/database';
import * as agentRunDb from '@iki/backend/db/agent_runs';
import { addWorkspace } from '@iki/backend/db/workspaces';
import { createChatService } from '@iki/backend/thread_session/service';
import { legacyTurnHarness, setTurnHarnessFallback } from '@iki/backend/thread_session/turn_supply_selection';
import {
  INPUT_ACCEPTED,
  recordSessionEvents,
  SESSION_EVENT_VERSION,
} from '@iki/backend/thread_session/session_log';
import { FauxModelProvider, fauxText } from '@iki/backend/agent/testing/faux_model';

// F5 boundary: a retry or queued resume replays the ORIGINAL task — since
// ADR 008 F3 the recovery source is the session log, so the fixture records
// the accepted-input fact the real turn start persists. The run row's plan
// fields stay the identity/plan source; its input copy is no longer read.
describe('run retry and queued resume at the service boundary', () => {
  let root: string;
  let service: ReturnType<typeof createChatService>;
  const target = { id: 3, send: vi.fn() };

  const seedRun = (
    runId: string,
    threadId: string,
    status: 'failed' | 'queued',
    prompt: string
  ) => {
    agentRunDb.createAgentRun({
      id: runId,
      kind: 'chat-turn',
      status,
      threadId,
      rootRunId: runId,
      providerType: 'openai',
      model: 'resume-model',
      systemPrompt: 'resume system',
      enabledTools: [],
      availableSkillIds: [],
      input: {
        prompt,
        messages: [{ role: 'user', content: prompt }],
        metadata: { transport: 'stream', maxIterations: 5, enableTools: false },
      },
      working: {
        modelMessages: [{ role: 'user', content: prompt }],
        accumulatedText: '',
        pendingApprovalIds: [],
        lastStepIndex: 0,
      },
      output: null,
      error: null,
    } as never);
    recordSessionEvents(threadId, [
      {
        type: INPUT_ACCEPTED,
        version: SESSION_EVENT_VERSION,
        payload: {
          messageId: `user_${runId}`,
          message: {
            id: `user_${runId}`,
            role: 'user',
            parts: [{ type: 'text', text: prompt }],
          } as never,
        },
      },
    ]);
  };

  beforeEach(async () => {
  // These suites drive the DURABLE layer (streaming, approvals, session-log
  // facts, retry, persistence) with a scripted AI SDK model. They are not about
  // which supply serves the turn, so they opt into the legacy executor: the
  // production default refuses a turn its projection cannot carry, and a
  // scripted model has no endpoint to project to.
  setTurnHarnessFallback(legacyTurnHarness);
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'iki-run-resume-'));
    userDataMock.mockReturnValue(root);
    initializeDatabase({ dbPath: path.join(root, 'resume.db') });
    addWorkspace({ id: 'ws_resume', path: root, name: 'resume' });
    const conversation = (service = createChatService()) as unknown as {
      createThread: (input: Record<string, unknown>) => unknown;
    };
    conversation.createThread({ id: 'thread_resume', workspace_id: 'ws_resume' });
    conversation.createThread({ id: 'thread_queued', workspace_id: 'ws_resume' });
  });

  afterEach(async () => {
    closeDatabase();
    await fs.rm(root, { recursive: true, force: true });
  });

  it('retryAndExecute replays the original task and adopts the queued run id', async () => {
    seedRun('run_failed_1', 'thread_resume', 'failed', 'ORIGINAL_TASK_MARKER');
    const model = new FauxModelProvider([fauxText('recovered answer')]);
    const providerCalls = vi.spyOn(model, 'doStream');
    createModelMock.mockReturnValue(model);

    const result = await service.retryAndExecute(target, 'run_failed_1');

    expect(result).toMatchObject({ success: true, newRunId: expect.any(String) });
    expect(providerCalls).toHaveBeenCalled();
    expect(JSON.stringify(providerCalls.mock.calls[0][0].prompt)).toContain(
      'ORIGINAL_TASK_MARKER'
    );

    const runs = agentRunDb.listAgentRunsByThread('thread_resume');
    expect(runs.map(run => run.id).sort()).toEqual(['run_failed_1', result.newRunId].sort());
    expect(runs.find(run => run.id === result.newRunId)?.status).toBe('completed');
    expect(runs.find(run => run.id === result.newRunId)?.parentRunId).toBe('run_failed_1');
    // No leftover repeatable queued record.
    expect(runs.find(run => run.status === 'queued')).toBeUndefined();
  });

  it('resumeRun executes a queued run in place and a second execute cannot re-start it', async () => {
    seedRun('run_queued_1', 'thread_queued', 'queued', 'QUEUED_TASK_MARKER');
    const model = new FauxModelProvider([fauxText('queued answer')]);
    const providerCalls = vi.spyOn(model, 'doStream');
    createModelMock.mockReturnValue(model);

    const first = await service.resumeRun(target, 'run_queued_1');
    expect(first).toMatchObject({ success: true });
    expect(JSON.stringify(providerCalls.mock.calls[0][0].prompt)).toContain(
      'QUEUED_TASK_MARKER'
    );
    // Adopted: the queued id became the executing run — no third identity.
    const runs = agentRunDb.listAgentRunsByThread('thread_queued');
    expect(runs.map(run => run.id)).toEqual(['run_queued_1']);
    expect(runs[0].status).toBe('completed');

    const second = await service.resumeRun(target, 'run_queued_1');
    expect(second.success).toBe(false);
    expect(providerCalls).toHaveBeenCalledTimes(1);
  });
});
