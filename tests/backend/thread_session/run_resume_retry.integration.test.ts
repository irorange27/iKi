import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const callPiChatMock = vi.hoisted(() => vi.fn());
const userDataMock = vi.hoisted(() => vi.fn(() => ''));

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
  resolvePersonaPrompt: () => 'persona prompt',
  getModelGenerationSettings: () => ({}),
  resolveModelCapability: async () => ({
    contextWindow: 100000,
    maxInputTokens: 98000,
    maxOutputTokens: 2000,
  }),
  getProviderConfig: () => ({
    type: 'openai',
    apiKey: 'key-test',
    baseURL: 'http://127.0.0.1:9/v1',
  }),
}));

import { closeDatabase, initializeDatabase } from '@iki/backend/db/database';
import { seedTurnProvider } from '../helpers/seed_turn_provider';
import * as agentRunDb from '@iki/backend/db/agent_runs';
import { addWorkspace } from '@iki/backend/db/workspaces';
import { createChatService } from '@iki/backend/thread_session/service';
import {
  piTurnHarness,
  setTurnHarnessFallback,
} from '@iki/backend/thread_session/turn_supply_selection';
import {
  INPUT_ACCEPTED,
  recordSessionEvents,
  SESSION_EVENT_VERSION,
} from '@iki/backend/thread_session/session_log';
import { createScriptedPiChat } from '@iki/backend/agent/testing/scripted_pi';

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
    setTurnHarnessFallback(piTurnHarness);
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'iki-run-resume-'));
    userDataMock.mockReturnValue(root);
    initializeDatabase({ dbPath: path.join(root, 'resume.db') });
    seedTurnProvider({ providerId: 'provider_primary', providerType: 'openai', model: 'test-model' });
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
    callPiChatMock.mockImplementation(
      createScriptedPiChat([
        [
          { kind: 'text', text: 'recovered answer' },
          { kind: 'done', reason: 'stop' },
        ],
      ])
    );
    const providerCalls = callPiChatMock;

    const result = await service.retryAndExecute(target, 'run_failed_1');

    expect(result).toMatchObject({ success: true, newRunId: expect.any(String) });
    expect(providerCalls).toHaveBeenCalled();
    expect(JSON.stringify(providerCalls.mock.calls[0][1])).toContain('ORIGINAL_TASK_MARKER');

    const runs = agentRunDb.listAgentRunsByThread('thread_resume');
    expect(runs.map(run => run.id).sort()).toEqual(['run_failed_1', result.newRunId].sort());
    expect(runs.find(run => run.id === result.newRunId)?.status).toBe('completed');
    expect(runs.find(run => run.id === result.newRunId)?.parentRunId).toBe('run_failed_1');
    expect(runs.find(run => run.status === 'queued')).toBeUndefined();
  });

  it('resumeRun executes a queued run in place and a second execute cannot re-start it', async () => {
    seedRun('run_queued_1', 'thread_queued', 'queued', 'QUEUED_TASK_MARKER');
    callPiChatMock.mockImplementation(
      createScriptedPiChat([
        [
          { kind: 'text', text: 'queued answer' },
          { kind: 'done', reason: 'stop' },
        ],
      ])
    );
    const providerCalls = callPiChatMock;

    const first = await service.resumeRun(target, 'run_queued_1');
    expect(first).toMatchObject({ success: true });
    expect(JSON.stringify(providerCalls.mock.calls[0][1])).toContain('QUEUED_TASK_MARKER');
    const runs = agentRunDb.listAgentRunsByThread('thread_queued');
    expect(runs.map(run => run.id)).toEqual(['run_queued_1']);
    expect(runs[0].status).toBe('completed');

    const second = await service.resumeRun(target, 'run_queued_1');
    expect(second.success).toBe(false);
    expect(providerCalls).toHaveBeenCalledTimes(1);
  });
});
