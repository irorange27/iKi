// @vitest-environment node

/**
 * Switch item 3c (issue #118): the supply-selection contract at its single
 * point. The Pi supply layer serves text-only turns and tool turns in EVERY
 * mode — autonomous batch continuation and handoff chains included — and the
 * approval-resume selection test admits autonomous paused plans, or a pause
 * would flip the supply mid-turn. Out-of-domain history and static-factory
 * providers keep the AI SDK harness.
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeDatabase, initializeDatabase } from '@iki/backend/db/database';
import { toModelInputMessages } from '@iki/backend/message/ui_messages';
import { addProvider } from '@iki/backend/db/providers';
import { AgentHarness } from '@iki/backend/agent/harness';
import { PiTextTurnHarness } from '@iki/backend/agent/runners/pi_text_turn_harness';
import { PiToolTurnHarness } from '@iki/backend/agent/runners/pi_tool_turn_harness';
import {
  pausedPlanRunsOnPiToolSupply,
  selectTurnHarness,
} from '@iki/backend/thread_session/turn_supply_selection';
import type { ExecutionPlan } from '@iki/backend/thread_session/execution_plan';

let root: string;

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'iki-turn-supply-selection-'));
  initializeDatabase({ dbPath: path.join(root, 'supply-selection.db') });
  addProvider({
    id: 'provider_pi_supply',
    name: 'Pi supply provider',
    type: 'custom-openai',
    api_key: 'key-pi',
    models: '["pi-model"]',
    base_url: 'http://127.0.0.1:9/v1',
    enabled: true,
  });
  addProvider({
    id: 'provider_sdk_supply',
    name: 'SDK supply provider',
    type: 'openai',
    api_key: 'key-sdk',
    models: '["sdk-model"]',
    base_url: 'http://127.0.0.1:9/v1',
    enabled: true,
  });
});

afterAll(async () => {
  closeDatabase();
  await fs.rm(root, { recursive: true, force: true });
});

const plan = (overrides: Partial<ExecutionPlan>): ExecutionPlan =>
  ({
    providerType: 'custom-openai',
    providerId: 'provider_pi_supply',
    model: 'pi-model',
    systemPrompt: '',
    enableTools: true,
    enabledTools: ['probe_read'],
    availableSkillIds: [],
    guardActive: false,
    requireApproval: false,
    autoApproveToolRequests: false,
    maxIterations: 8,
    contextTokens: 1,
    skillMode: 'manual' as const,
    kind: 'chat-turn' as const,
    runMetadata: {},
    transport: 'chat.stream',
    ...overrides,
  }) as ExecutionPlan;

const history = [{ role: 'user' as const, content: 'probe' }];

describe('selectTurnHarness (switch item 3c: autonomous turns on Pi)', () => {
  it('serves an autonomous tool turn with the Pi tool harness (was AI SDK before 3c)', () => {
    const harness = selectTurnHarness(
      plan({ autonomous: { maxIterations: 3, continuePrompt: 'continue' } }),
      history
    );
    expect(harness).toBeInstanceOf(PiToolTurnHarness);
  });

  it('serves a non-autonomous tool turn with the Pi tool harness (3a/3b unchanged)', () => {
    expect(selectTurnHarness(plan({}), history)).toBeInstanceOf(PiToolTurnHarness);
  });

  it('serves a text-only turn with the Pi text harness regardless of mode', () => {
    const autonomous = plan({
      enableTools: false,
      enabledTools: [],
      autonomous: { maxIterations: 2 },
    });
    expect(selectTurnHarness(autonomous, history)).toBeInstanceOf(PiTextTurnHarness);
  });

  it('keeps a static-factory provider on the AI SDK harness in autonomous mode', () => {
    const harness = selectTurnHarness(
      plan({
        providerType: 'openai',
        providerId: 'provider_sdk_supply',
        model: 'sdk-model',
        autonomous: { maxIterations: 3 },
      }),
      history
    );
    expect(harness).toBeInstanceOf(AgentHarness);
  });

  it('keeps out-of-domain history on the AI SDK harness (the projection domain gate)', () => {
    const harness = selectTurnHarness(
      plan({ autonomous: { maxIterations: 3 } }),
      [
        // Approval parts throw in the projection — the out-of-domain probe.
        {
          role: 'assistant',
          content: [
            {
              type: 'tool-approval-response',
              approvalId: 'ap_1',
              approved: true,
            } as never,
          ],
        },
      ]
    );
    expect(harness).toBeInstanceOf(AgentHarness);
  });
});

describe('pausedPlanRunsOnPiToolSupply (switch item 3c: autonomous resumes stay on Pi)', () => {
  it('admits an autonomous paused plan (was excluded before 3c)', () => {
    expect(
      pausedPlanRunsOnPiToolSupply(plan({ autonomous: { maxIterations: 3 } }), history)
    ).toBe(true);
  });

  it('admits a non-autonomous paused plan (3b unchanged)', () => {
    expect(pausedPlanRunsOnPiToolSupply(plan({}), history)).toBe(true);
  });

  it('refuses a text-only plan', () => {
    expect(
      pausedPlanRunsOnPiToolSupply(
        plan({ enableTools: false, enabledTools: [] }),
        history
      )
    ).toBe(false);
  });

  it('refuses a restart-recovered replay history — the live approval part is outside the Pi domain (F2 supply flip, documented)', async () => {
    // What rebuildThreadViewFromEvents → toModelInputMessages(repair:false)
    // yields for a paused turn: the assistant partial carries the live
    // approval-request pair. The Pi projection rejects that part type, so a
    // RESTART-recovered resume of a Pi-paused turn runs the AI SDK harness —
    // the flip is deliberate and ledgered (ADR 008 F2 review, follow-up
    // issue) until the projection learns the part.
    const recoveredHistory = await toModelInputMessages(
      [
        {
          id: 'user_1',
          role: 'user',
          parts: [{ type: 'text', text: 'write it' }],
        },
        {
          id: 'assistant_1',
          role: 'assistant',
          parts: [
            { type: 'text', text: 'working', state: 'done' },
            {
              type: 'dynamic-tool',
              toolCallId: 'call_paused',
              toolName: 'write_file',
              state: 'approval-requested',
              input: { path: 'a.txt', content: 'x' },
              approval: { id: 'approval_1' },
            },
          ],
        },
      ] as never,
      { repairInterruptedTools: false }
    );
    expect(
      pausedPlanRunsOnPiToolSupply(plan({}), recoveredHistory as never)
    ).toBe(false);
  });

  it('refuses a static-factory provider', () => {
    expect(
      pausedPlanRunsOnPiToolSupply(
        plan({
          providerType: 'openai',
          providerId: 'provider_sdk_supply',
          model: 'sdk-model',
        }),
        history
      )
    ).toBe(false);
  });
});
