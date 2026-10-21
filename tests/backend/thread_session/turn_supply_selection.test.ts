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
import { projectHistoryToPiContext } from '@iki/backend/provider/llm/pi_adapter';
import { addProvider } from '@iki/backend/db/providers';
import { PiTextTurnHarness } from '@iki/backend/agent/runners/pi_text_turn_harness';
import { PiToolTurnHarness } from '@iki/backend/agent/runners/pi_tool_turn_harness';
import {
  PiSupplyRefusedError,
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
    budget: { step: 8 },
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
      plan({ budget: { step: 8, batch: { max: 3, continuePrompt: 'continue' } } }),
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
      budget: { step: 8, batch: { max: 2 } },
    });
    expect(selectTurnHarness(autonomous, history)).toBeInstanceOf(PiTextTurnHarness);
  });

  it('serves a static-factory provider on the Pi harness in autonomous mode', () => {
    // Contract change: `STATIC_PROVIDER_MODEL_FACTORIES[type]` used to exclude
    // openai/anthropic/minimax/deepseek from the Pi supply, so the harness
    // selector kept them on `AgentHarness`. Pi now drives those dialects
    // (resolveProviderApi), so the selector admits them — one supply for every
    // provider, which is what "no long-term double-driving" requires.
    const harness = selectTurnHarness(
      plan({
        providerType: 'openai',
        providerId: 'provider_sdk_supply',
        model: 'sdk-model',
        budget: { step: 8, batch: { max: 3 } },
      }),
      history
    );
    // The retired AI SDK harness no longer exists; what matters is that the
    // provider is served by the Pi harness rather than refused.
    expect(harness).toBeInstanceOf(PiToolTurnHarness);
  });

  it('REFUSES out-of-domain history instead of silently re-routing (the projection domain gate)', () => {
    // Contract change: this used to return the AI SDK harness, which meant the
    // user's turn ran on a different executor than the one under test and the
    // only trace was a log line. A refusal is now terminal and names the part
    // the projection cannot represent — the domain should grow to cover it,
    // not be worked around at runtime.
    expect(() =>
      selectTurnHarness(
        plan({ budget: { step: 8, batch: { max: 3 } } }),
        [
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
      )
    ).toThrow(PiSupplyRefusedError);

    // The message must say WHAT could not be projected and that nothing was
    // sent, so the failure is actionable rather than a generic turn error.
    expect(() =>
      selectTurnHarness(
        plan({ budget: { step: 8, batch: { max: 3 } } }),
        [
          {
            role: 'assistant',
            content: [
              { type: 'tool-approval-response', approvalId: 'ap_1', approved: true } as never,
            ],
          },
        ]
      )
    ).toThrow(/tool-approval-response/);
  });
});

describe('pausedPlanRunsOnPiToolSupply (switch item 3c: autonomous resumes stay on Pi)', () => {
  it('admits an autonomous paused plan (was excluded before 3c)', () => {
    expect(
      pausedPlanRunsOnPiToolSupply(plan({ budget: { step: 8, batch: { max: 3 } } }), history)
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

  it('admits a restart-recovered replay history — the pairing stamps strip to the Pi wire domain (issue #133)', async () => {
    // What rebuildThreadViewFromEvents → toModelInputMessages(repair:false)
    // yields for a paused turn: the assistant partial carries the live
    // approval-request pair. piDomainResumeHistory strips those stamps (the
    // live mirror never carried them — the pause registers
    // harness.getHistory()), so a RESTART-recovered resume of a Pi-paused
    // turn answers the selection identically to the live path and resumes on
    // the Pi harness. This flips the supply flip documented at the ADR 008
    // F2 review; a genuinely out-of-domain part (tool-approval-response)
    // still refuses — pinned in the fresh-selection test above.
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
    ).toBe(true);
  });

  it('keeps the projection itself refusing tool-approval-request — the strip is the only sanctioned normalization', () => {
    // Bypasses the converter AND the resume-path strip on purpose: the
    // projection-level contract is that a request part reaching it throws.
    // Only piDomainResumeHistory strips them, upstream of the resume gate —
    // a future "symmetric" widening of that strip would silence the flipped
    // selection pin above, so the throw is pinned directly.
    const stampedModelHistory = [
      { role: 'user' as const, content: 'probe' },
      {
        role: 'assistant' as const,
        content: [
          { type: 'tool-call', toolCallId: 'call_x', toolName: 'write_file', input: {} },
          { type: 'tool-approval-request', approvalId: 'approval_1' },
        ] as never,
      },
    ];
    expect(() => projectHistoryToPiContext(stampedModelHistory, 'pi-model')).toThrow(
      'tool-approval-request'
    );
  });

  it('admits a static-factory provider (one supply for every provider type)', () => {
    expect(
      pausedPlanRunsOnPiToolSupply(
        plan({
          providerType: 'openai',
          providerId: 'provider_sdk_supply',
          model: 'sdk-model',
        }),
        history
      )
    ).toBe(true);
  });
});
