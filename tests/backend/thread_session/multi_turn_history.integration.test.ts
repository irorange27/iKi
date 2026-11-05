/**
 * The one requirement that is not negotiable: a user can keep talking to the agent,
 * and every model request is (the whole validated past) + (this turn's input).
 *
 * The LLM API is stateless, so "the conversation cache is healthy" means concrete,
 * checkable things. They are asserted here at the service boundary with a scripted
 * provider, on both ways history reaches the wire:
 *  - a live turn, where the caller sends the message array it holds
 *    (ipc_chat_transport.ts: sendMessages({ messages }) ships the whole array);
 *  - a retried turn after the process died, where the SESSION LOG is the only source
 *    of the past (ADR-008).
 *
 * Both must carry the composed system prompt exactly once. The resume path used to
 * prepend the prompt stored on the input fact, so a resumed turn sent the persona,
 * workspace and skill list twice — the stale copy first, winning the slot.
 */
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

vi.mock('@iki/core/platform', async importOriginal => ({
  ...(await importOriginal<typeof import('@iki/core/platform')>()),
  getUserDataPath: userDataMock,
}));

vi.mock('@iki/backend/provider/llm/factory', async importOriginal => ({
  ...(await importOriginal<typeof import('@iki/backend/provider/llm/factory')>()),
  resolvePersonaPrompt: () => 'PERSONA_PROMPT_MARKER',
  getModelGenerationSettings: () => ({}),
  resolveModelCapability: async () => ({
    contextWindow: 100000,
    maxInputTokens: 98000,
    maxOutputTokens: 2000,
  }),
  getProviderConfig: () => ({
    type: 'openai',
    apiKey: '{{SECRET_testkey1}}',
    baseURL: 'http://127.0.0.1:9/v1',
  }),
}));

import { closeDatabase, initializeDatabase } from '@iki/store/database';
import { seedTurnProvider } from '../helpers/seed_turn_provider';
import * as agentRunDb from '@iki/store/agent_runs';
import { addWorkspace } from '@iki/store/workspaces';
import { createChatService } from '@iki/backend/thread_session/service';
import {
  piTurnHarness,
  setTurnHarnessFallback,
} from '@iki/backend/thread_session/turn_supply_selection';
import { createScriptedPiChat } from '@iki/backend/agent/testing/scripted_pi';

const TURN_ONE_INPUT = 'FIRST_TURN_MARKER read the manifest';
const TURN_ONE_ANSWER = 'FIRST_TURN_ANSWER the manifest lists three files';
const TURN_TWO_INPUT = 'SECOND_TURN_MARKER now summarize them';

type SentRequest = { systemPrompt: string; messages: Array<{ role: string; content: unknown }> };

const sentRequests = (): SentRequest[] =>
  callPiChatMock.mock.calls.map(call => call[1] as SentRequest);

const expectOneSystemPrompt = (request: SentRequest) => {
  expect(request.systemPrompt).toContain('PERSONA_PROMPT_MARKER');
  expect((request.systemPrompt.match(/PERSONA_PROMPT_MARKER/g) ?? []).length).toBe(1);
  // Instructions are not transcript: no system message may ride in the history.
  expect(request.messages.filter(message => message.role === 'system')).toHaveLength(0);
};

describe('multi-turn conversation at the service boundary', () => {
  let root: string;
  let service: ReturnType<typeof createChatService>;
  const target = { id: 7, send: vi.fn() };

  const uiUser = (id: string, text: string) => ({
    id,
    role: 'user',
    parts: [{ type: 'text', text }],
  });
  const uiAssistant = (id: string, text: string) => ({
    id,
    role: 'assistant',
    parts: [{ type: 'text', text, state: 'done' }],
  });

  const streamTurn = async (threadId: string, messages: unknown[]) => {
    const result = await service.stream(target, {
      providerType: 'openai',
      model: 'test-model',
      threadId,
      tools: [],
      messages: messages as never,
      runConfig: { kind: 'chat-turn' },
    });
    return result as { success?: boolean; runId?: string; error?: string };
  };

  const scriptTurn = (answer: string) =>
    callPiChatMock.mockImplementation(
      createScriptedPiChat([
        [{ kind: 'text', text: answer }, { kind: 'done', reason: 'stop' }],
      ])
    );

  beforeEach(async () => {
    setTurnHarnessFallback(piTurnHarness);
    callPiChatMock.mockReset();
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'iki-multi-turn-'));
    userDataMock.mockReturnValue(root);
    initializeDatabase({ dbPath: path.join(root, 'turns.db') });
    seedTurnProvider({
      providerId: 'provider_primary',
      providerType: 'openai',
      model: 'test-model',
    });
    addWorkspace({ id: 'ws_turns', path: root, name: 'turns' });
    service = createChatService();
    const conversation = service as unknown as {
      createThread: (input: Record<string, unknown>) => unknown;
    };
    conversation.createThread({ id: 'thread_turns', workspace_id: 'ws_turns' });
    conversation.createThread({ id: 'thread_crash', workspace_id: 'ws_turns' });
  });

  afterEach(async () => {
    closeDatabase();
    await fs.rm(root, { recursive: true, force: true });
  });

  it('a second turn sends the first turn whole, in order, with nothing repeated', async () => {
    scriptTurn(TURN_ONE_ANSWER);
    expect(await streamTurn('thread_turns', [uiUser('msg_u1', TURN_ONE_INPUT)])).toMatchObject({
      success: true,
    });

    scriptTurn('SECOND_TURN_ANSWER here is the summary');
    expect(
      await streamTurn('thread_turns', [
        uiUser('msg_u1', TURN_ONE_INPUT),
        uiAssistant('msg_a1', TURN_ONE_ANSWER),
        uiUser('msg_u2', TURN_TWO_INPUT),
      ])
    ).toMatchObject({ success: true });

    const requests = sentRequests();
    expect(requests).toHaveLength(2);
    requests.forEach(expectOneSystemPrompt);

    const second = requests[1];
    const wire = JSON.stringify(second.messages);
    expect(wire).toContain('FIRST_TURN_MARKER');
    expect(wire).toContain('FIRST_TURN_ANSWER');
    expect(wire).toContain('SECOND_TURN_MARKER');
    expect(second.messages.map(message => message.role)).toEqual(['user', 'assistant', 'user']);
    // The assembler must not fold the newest input into the history as well.
    expect((wire.match(/SECOND_TURN_MARKER/g) ?? []).length).toBe(1);
  });

  it('a retry after the provider died rebuilds the whole past from the session log', async () => {
    scriptTurn(TURN_ONE_ANSWER);
    await streamTurn('thread_crash', [uiUser('msg_u1', TURN_ONE_INPUT)]);

    // Turn 2 reaches the log as an accepted input, then its model call dies.
    callPiChatMock.mockImplementationOnce(() => {
      throw new Error('PROVIDER_DIED_MARKER connection reset');
    });
    const deadRun = await streamTurn('thread_crash', [
      uiUser('msg_u1', TURN_ONE_INPUT),
      uiAssistant('msg_a1', TURN_ONE_ANSWER),
      uiUser('msg_u2', 'CRASHED_TURN_MARKER what changed since?'),
    ]);
    const deadRunId = deadRun.runId!;
    expect(agentRunDb.getAgentRun(deadRunId)?.status).toBe('failed');

    // Simulate the restart: no live session, only the database and the failed row.
    callPiChatMock.mockReset();
    scriptTurn('REBUILT_ANSWER since the manifest, nothing changed');

    const retried = await service.retryAndExecute(target, deadRunId);
    expect(retried).toMatchObject({ success: true });

    const request = sentRequests().at(-1) as SentRequest;
    const wire = JSON.stringify(request.messages);
    expectOneSystemPrompt(request);
    // The past comes back from the log, not from a client that no longer exists.
    expect(wire).toContain('FIRST_TURN_MARKER');
    expect(wire).toContain('FIRST_TURN_ANSWER');
    expect(wire).toContain('CRASHED_TURN_MARKER');
    // Each message exactly once: the dead run's own committed output is excluded by
    // its run id, so the replay cannot show that turn twice.
    expect((wire.match(/FIRST_TURN_MARKER/g) ?? []).length).toBe(1);
    expect((wire.match(/CRASHED_TURN_MARKER/g) ?? []).length).toBe(1);
    expect(request.messages.filter(message => message.role === 'user')).toHaveLength(2);
  });
});
