// @vitest-environment node

/**
 * Cancellation must reach the execution it names, not just the run row.
 *
 * The defect: `chatService.cancelRun(runId)` looked only at the stream
 * registry (`abortStreamByRunId`). The non-streaming `send` transport holds
 * its own AbortController and registers no stream, so cancelRun fell through
 * to `rehydrateAgentRunTracker(runId).markCancelled(...)` — a durable
 * terminal write with nothing actually stopped. The tool handler kept
 * running, and when it finished, the live tracker appended a step at an
 * index the cancellation writer had already used:
 * `UNIQUE constraint failed: agent_run_steps.run_id, agent_run_steps.step_index`.
 *
 * These tests pin the contract at the real consumer boundary (the chat
 * service + SQLite), not a mocked registry: a cancelled run's execution
 * observes its abort signal, and no writer may append to a cancelled run.
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

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
  // These suites verify DURABLE behaviour (effect-aware retry, cancel routing,
  // handoff facts, inline journaling) using a scripted AI SDK model. They are
  // not about supply routing, so they pin the AI SDK harness explicitly: Pi
  // claims every provider type now, and a stubbed `createModel` would never be
  // reached. Routing itself is covered by factory_pi_generation.test.ts and
  // turn_supply_selection.test.ts.
  supportsPiTurnSupply: () => false,
}));

import { closeDatabase, initializeDatabase } from '@iki/backend/db/database';
import { addProvider } from '@iki/backend/db/providers';
import * as agentRunDb from '@iki/backend/db/agent_runs';
import { addWorkspace } from '@iki/backend/db/workspaces';
import { createChatService } from '@iki/backend/thread_session/service';
import { piTurnHarness, setTurnHarnessFallback } from '@iki/backend/thread_session/turn_supply_selection';
import { FauxModelProvider, fauxText, fauxToolCall } from '@iki/backend/agent/testing/faux_model';
import { createTool, defaultToolRegistry } from '@iki/backend/tools';
import { getToolRuntimeContext } from '@iki/backend/utils/runtime_context';

const TOOL_NAME = 'cancel_probe';
const TASK_TEXT = 'CANCEL_PROBE run the tool';

describe('cancelling a run reaches the execution that owns it', () => {
  let root: string;
  let service: ReturnType<typeof createChatService>;
  const target = { id: 11, send: vi.fn() };

  beforeEach(async () => {
  // These suites drive the DURABLE layer (streaming, approvals, session-log
  // facts, retry, persistence) with a scripted AI SDK model. They are not about
  // which supply serves the turn, so they opt into the legacy executor: the
  // production default refuses a turn its projection cannot carry, and a
  // scripted model has no endpoint to project to.
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

    createModelMock.mockReturnValue(
      new FauxModelProvider([
        fauxToolCall(TOOL_NAME, { path: '/probe.txt' }, { id: 'call_cancel_1' }),
        fauxText('finished after the tool'),
      ])
    );

    // The non-streaming send transport: it registers no stream, so nothing
    // in the stream registry names this run.
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

    // Contract 1: the execution that owns the run observes the cancellation.
    expect(observedSignal?.aborted).toBe(true);

    release();
    const outcome = await pending;

    // Contract 2: the cancelled run stays cancelled and no late writer
    // appended to it (the old behavior surfaced as a UNIQUE step-index
    // constraint failure here).
    expect('error' in outcome ? String(outcome.error) : '').not.toContain('UNIQUE constraint');
    expect(agentRunDb.getAgentRun(run!.id)?.status).toBe('cancelled');

    const stepIndexes = agentRunDb
      .listAgentRunSteps(run!.id)
      .map(step => step.stepIndex);
    expect(new Set(stepIndexes).size).toBe(stepIndexes.length);
  });
});
