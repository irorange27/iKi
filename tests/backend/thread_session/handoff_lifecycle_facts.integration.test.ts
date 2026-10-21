// @vitest-environment node

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

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
  supportsPiTurnSupply: () => false,
}));

import { closeDatabase, initializeDatabase } from '@iki/backend/db/database';
import { addProvider } from '@iki/backend/db/providers';
import * as agentRunDb from '@iki/backend/db/agent_runs';
import { getSessionEvents } from '@iki/backend/db/session_events';
import { addWorkspace } from '@iki/backend/db/workspaces';
import { createChatService } from '@iki/backend/thread_session/service';
import {
  piTurnHarness,
  setTurnHarnessFallback,
} from '@iki/backend/thread_session/turn_supply_selection';
import { createScriptedPiChat } from '@iki/backend/agent/testing/scripted_pi';
import { createTool, defaultToolRegistry } from '@iki/backend/tools';
import { rebuildThreadViewFromEvents } from '@iki/backend/thread_session/session_log';

const HANDOFF = 'handoff';

describe('a handoff chain records the run segment swap in the session log', () => {
  let root: string;
  let service: ReturnType<typeof createChatService>;
  const target = { id: 41, send: vi.fn() };

  beforeEach(async () => {
    setTurnHarnessFallback(piTurnHarness);
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'iki-handoff-facts-'));
    userDataMock.mockReturnValue(root);
    initializeDatabase({ dbPath: path.join(root, 'handoff.db') });
    addProvider({
      id: 'provider_handoff',
      name: 'handoff',
      type: 'openai',
      api_key: 'key-handoff',
      models: '["handoff-model"]',
      base_url: 'http://127.0.0.1:9/v1',
      enabled: true,
    });
    addWorkspace({ id: 'ws_handoff', path: root, name: 'handoff' });
    const conversation = (service = createChatService()) as unknown as {
      createThread: (input: Record<string, unknown>) => unknown;
    };
    conversation.createThread({ id: 'thread_handoff', workspace_id: 'ws_handoff' });
    defaultToolRegistry.register(
      createTool({
        name: HANDOFF,
        type: 'function',
        description: 'hand the task over',
        paramSchema: z.object({
          summary: z.string(),
          next_steps: z.string(),
          reason: z.string().optional(),
        }),
        handler: async args => args,
      })
    );
  });

  afterEach(async () => {
    defaultToolRegistry.remove(HANDOFF);
    closeDatabase();
    await fs.rm(root, { recursive: true, force: true });
  });

  it('records the parent segment terminal and the child segment start', async () => {
    callPiChatMock.mockImplementation(
      createScriptedPiChat([
        [
          {
            kind: 'toolCall',
            toolName: HANDOFF,
            args: {
              summary: 'phase one done',
              next_steps: 'finish phase two',
              reason: 'context_limit',
            },
          },
          { kind: 'done', reason: 'toolUse' },
        ],
        [
          { kind: 'text', text: 'phase two complete' },
          { kind: 'done', reason: 'stop' },
        ],
      ])
    );

    const result = await service.stream(target, {
      providerType: 'openai',
      providerId: 'provider_handoff',
      model: 'handoff-model',
      threadId: 'thread_handoff',
      approvalPolicy: 'never',
      autonomous: { maxIterations: 3, continuePrompt: 'continue' },
      messages: [
        { id: 'msg_handoff', role: 'user', parts: [{ type: 'text', text: 'pass the baton' }] },
      ],
      tools: [HANDOFF],
    });
    expect(result).toMatchObject({ success: true });

    const rows = agentRunDb.listAgentRunsByThread('thread_handoff');
    const parent = rows.find(run => run.kind === 'chat-turn')!;
    const child = rows.find(run => run.kind === 'handoff-resume')!;
    expect(parent.status).toBe('completed');
    expect(child.status).toBe('completed');

    const replay = rebuildThreadViewFromEvents('thread_handoff');
    const parentTurn = replay.turns.find(turn => turn.runId === parent.id);
    const childTurn = replay.turns.find(turn => turn.runId === child.id);

    expect(parentTurn?.status).toBe('completed');
    expect(childTurn).toBeDefined();
    expect(childTurn?.kind).toBe('handoff-resume');
    expect(childTurn?.status).toBe('completed');

    const terminalEvents = getSessionEvents('thread_handoff', [
      'turn_completed',
      'turn_failed',
      'turn_cancelled',
    ]);
    const terminalRunIds = terminalEvents.map(event => (event.payload as { runId?: string }).runId);
    expect(terminalRunIds.filter(runId => runId === parent.id)).toHaveLength(1);
    expect(terminalRunIds.filter(runId => runId === child.id)).toHaveLength(1);
  });
  it('loses the child segment cleanly when its start write fails', async () => {
    callPiChatMock.mockImplementation(
      createScriptedPiChat([
        [
          {
            kind: 'toolCall',
            toolName: HANDOFF,
            args: {
              summary: 'phase one done',
              next_steps: 'finish phase two',
              reason: 'context_limit',
            },
          },
          { kind: 'done', reason: 'toolUse' },
        ],
        [
          { kind: 'text', text: 'phase two complete' },
          { kind: 'done', reason: 'stop' },
        ],
      ])
    );

    const { getDb } = await import('@iki/backend/db/database');
    getDb().exec(`CREATE TRIGGER handoff_swap_reject_started BEFORE INSERT ON session_events
      WHEN NEW.type = 'turn_started' AND json_extract(NEW.payload, '$.kind') = 'handoff-resume'
      BEGIN SELECT RAISE(ABORT, 'handoff swap: started write rejected'); END`);
    try {
      await service.stream(target, {
        providerType: 'openai',
        providerId: 'provider_handoff',
        model: 'handoff-model',
        threadId: 'thread_handoff',
        approvalPolicy: 'never',
        autonomous: { maxIterations: 3, continuePrompt: 'continue' },
        messages: [
          {
            id: 'msg_handoff_fail',
            role: 'user',
            parts: [{ type: 'text', text: 'pass the baton' }],
          },
        ],
        tools: [HANDOFF],
      });
    } finally {
      getDb().exec('DROP TRIGGER IF EXISTS handoff_swap_reject_started');
    }

    const rows = agentRunDb.listAgentRunsByThread('thread_handoff');
    const replay = rebuildThreadViewFromEvents('thread_handoff');

    const parentRow = rows.find(run => run.kind === 'chat-turn')!;
    const parentTurn = replay.turns.find(turn => turn.runId === parentRow.id)!;
    expect(parentTurn).toBeDefined();
    const parentTerminal = parentTurn.status !== 'running';
    expect(parentTerminal).toBe(['completed', 'failed', 'cancelled'].includes(parentRow.status));

    const startedRunIds = new Set(
      getSessionEvents('thread_handoff', ['turn_started']).map(
        event => (event.payload as { runId?: string }).runId
      )
    );
    const orphanTerminals = replay.turns.filter(
      turn => turn.status !== 'running' && !startedRunIds.has(turn.runId)
    );
    for (const turn of orphanTerminals) {
      const row = rows.find(run => run.id === turn.runId)!;
      expect(row.kind).toBe('handoff-resume');
      expect(turn.status).toBe('failed');
    }
    expect(orphanTerminals.length).toBeLessThanOrEqual(1);
  });
});
