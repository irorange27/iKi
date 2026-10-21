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
import { addWorkspace } from '@iki/backend/db/workspaces';
import { createChatService } from '@iki/backend/thread_session/service';
import {
  piTurnHarness,
  setTurnHarnessFallback,
} from '@iki/backend/thread_session/turn_supply_selection';
import { createScriptedPiChat } from '@iki/backend/agent/testing/scripted_pi';
import { createTool, defaultToolRegistry } from '@iki/backend/tools';
import { getToolRuntimeContext } from '@iki/backend/utils/runtime_context';

const TOOL_NAME = 'cancel_probe';
const TASK_TEXT = 'CANCEL_PROBE run the tool';

describe('cancelling a run reaches the execution that owns it', () => {
  let root: string;
  let service: ReturnType<typeof createChatService>;
  const target = { id: 11, send: vi.fn() };

  beforeEach(async () => {
    setTurnHarnessFallback(piTurnHarness);
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'iki-cancel-'));
    userDataMock.mockReturnValue(root);
    initializeDatabase({ dbPath: path.join(root, 'cancel.db') });
    addProvider({
      id: 'provider_cancel',
      name: 'cancel',
      type: 'openai',
      api_key: 'key-cancel',
      models: '["cancel-model"]',
      base_url: 'http://127.0.0.1:9/v1',
      enabled: true,
    });
    addWorkspace({ id: 'ws_cancel', path: root, name: 'cancel' });
    const conversation = (service = createChatService()) as unknown as {
      createThread: (input: Record<string, unknown>) => unknown;
    };
    conversation.createThread({ id: 'thread_cancel', workspace_id: 'ws_cancel' });
  });

  afterEach(async () => {
    defaultToolRegistry.remove(TOOL_NAME);
    closeDatabase();
    await fs.rm(root, { recursive: true, force: true });
  });

  it('aborts the running tool handler and never appends a step to the cancelled run', async () => {
    let entered!: () => void;
    const started = new Promise<void>(resolve => {
      entered = resolve;
    });
    let release!: () => void;
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });
    let observedSignal: AbortSignal | undefined;

    defaultToolRegistry.register(
      createTool({
        name: TOOL_NAME,
        type: 'fs',
        description: 'blocks until released',
        paramSchema: z.object({ path: z.string() }),
        handler: async () => {
          observedSignal = getToolRuntimeContext().abortSignal;
          entered();
          await gate;
          return 'probe finished';
        },
      })
    );

    callPiChatMock.mockImplementation(
      createScriptedPiChat([
        [
          {
            kind: 'toolCall',
            toolName: TOOL_NAME,
            args: { path: '/probe.txt' },
            id: 'call_cancel_1',
          },
          { kind: 'done', reason: 'toolUse' },
        ],
        [
          { kind: 'text', text: 'finished after the tool' },
          { kind: 'done', reason: 'stop' },
        ],
      ])
    );

    const pending = service
      .send({
        providerType: 'openai',
        providerId: 'provider_cancel',
        model: 'cancel-model',
        threadId: 'thread_cancel',
        approvalPolicy: 'never',
        messages: [{ id: 'msg_cancel', role: 'user', parts: [{ type: 'text', text: TASK_TEXT }] }],
        tools: [TOOL_NAME],
      })
      .then(
        value => ({ value }) as const,
        error => ({ error }) as const
      );

    await started;

    const run = agentRunDb
      .listAgentRunsByThread('thread_cancel')
      .find(candidate => candidate.status === 'running');
    expect(run).toBeDefined();

    const cancelled = service.cancelRun(run!.id);
    expect(cancelled).toEqual({ success: true });

    expect(observedSignal?.aborted).toBe(true);

    release();
    const outcome = await pending;

    expect('error' in outcome ? String(outcome.error) : '').not.toContain('UNIQUE constraint');
    expect(agentRunDb.getAgentRun(run!.id)?.status).toBe('cancelled');

    const stepIndexes = agentRunDb.listAgentRunSteps(run!.id).map(step => step.stepIndex);
    expect(new Set(stepIndexes).size).toBe(stepIndexes.length);
  });
});
