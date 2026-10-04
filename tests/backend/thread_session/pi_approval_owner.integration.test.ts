// @vitest-environment node

/**
 * Switch item 3b (issue #116): the Pi tool resume through the REAL five-state
 * owner. The harness carries resumeCommands + the owner port; the decisions
 * are recorded the way the approval flow records them (answerToolCallApproval).
 * Proven at the owner boundary:
 *   - an approved call executes exactly once, with the bound args;
 *   - the owner's execution facts (prepared/started/finished) land in the
 *     session log;
 *   - a REPLAY of the same resume joins the recorded result — no second
 *     effect (the owner's duplicate contract, exercised through the Pi path);
 *   - a rejected call yields the canonical execution-denied result with zero
 *     effects.
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { closeDatabase, initializeDatabase } from '@iki/backend/db/database';
import { addProvider } from '@iki/backend/db/providers';
import { addChatThread } from '@iki/backend/db/chat_thread';
import {
  answerToolCallApproval,
  upsertToolCallApprovalSession,
  upsertToolCallApprovals,
} from '@iki/backend/db/tool_call_approval';
import { getSessionEvents } from '@iki/backend/db/session_events';
import { recordSessionEvents, SESSION_EVENT_VERSION } from '@iki/backend/thread_session/session_log';
import {
  prepareToolExecution,
  executeApprovedTool,
  TOOL_EXECUTION_FINISHED,
  TOOL_EXECUTION_PREPARED,
  TOOL_EXECUTION_STARTED,
} from '@iki/backend/thread_session/tool_execution';
import { PiToolTurnHarness } from '@iki/backend/agent/runners/pi_tool_turn_harness';
import type { ModelMessage } from 'ai';
import { createAssistantMessageEventStream, type AssistantMessage } from '@earendil-works/pi-ai';
import { createTool, defaultToolRegistry } from '@iki/backend/tools';

let root: string;
const executions: string[] = [];
const TOOL_NAME = 'pi_owner_probe';

const address = { threadId: 'thread_pi_owner', approvalId: 'ap_owner' };

const pausedHistory = (toolCallId: string): ModelMessage[] => [
  { role: 'user', content: 'probe' },
  {
    role: 'assistant',
    content: [{ type: 'tool-call', toolCallId, toolName: TOOL_NAME, input: { path: '/owner.txt' } }],
  },
];

const buildHarness = (commands: Array<{ approvalId: string; toolCallId: string }>) =>
  new PiToolTurnHarness(
    {
      providerType: 'custom-openai',
      providerId: 'provider_pi_owner',
      model: 'pi-model',
      systemPrompt: 'tool mode prompt',
      enableTools: true,
      enabledToolNames: [TOOL_NAME],
      availableSkillIds: [],
      guardActive: false,
      requireApproval: false,
      autoApproveToolRequests: false,
      approvalPolicy: 'always',
      maxIterations: 4,
      threadId: address.threadId,
    },
    {
      // The resumed segment continues the loop: one model call asks the model
      // to speak over the executed result.
      modelCall: () => {
        const final: AssistantMessage = {
          role: 'assistant',
          content: [{ type: 'text', text: 'done' }],
          api: 'openai-completions',
          provider: 'iki-custom',
          model: 'pi-model',
          usage: { input: 5, output: 2, cacheRead: 0, cacheWrite: 0, reasoning: 0, totalTokens: 7, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
          stopReason: 'stop',
          timestamp: Date.now(),
        };
        const stream = createAssistantMessageEventStream();
        stream.push({ type: 'start', partial: final });
        stream.push({ type: 'done', reason: 'stop', message: final });
        return {
          events: (async function* () {
            // The resumed continuation's deltas are not under test here.
            return;
            // eslint-disable-next-line no-unreachable
            yield {} as never;
          })(),
          final: stream.result(),
        };
      },
      resume: {
        commands: commands.map(command => ({
          ...command,
          toolName: TOOL_NAME,
          args: { path: '/owner.txt' },
        })),
        owner: {
          prepare: ownerAddress => prepareToolExecution(ownerAddress),
          executeApproved: (ownerAddress, port) =>
            executeApprovedTool(ownerAddress, {
              signal: port.signal,
              execute: async (toolName, args) =>
                (await port.execute(toolName, args as Record<string, unknown>)) as unknown,
            }),
        },
      },
    }
  );

const collect = async (harness: PiToolTurnHarness) => {
  const events: import('@iki/backend/agent/harness/harness_types').TurnEvent[] = [];
  for await (const event of harness.turn({ prompt: '', history: pausedHistory('call_owner') })) {
    events.push(event);
  }
  return events;
};

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'iki-pi-owner-'));
  initializeDatabase({ dbPath: path.join(root, 'owner.db') });
  addProvider({
    id: 'provider_pi_owner',
    name: 'Pi owner provider',
    type: 'custom-openai',
    api_key: 'key-owner',
    models: '["pi-model"]',
    base_url: 'http://127.0.0.1:9/v1',
    enabled: true,
  });
  addChatThread({
    id: address.threadId,
    title: 'pi owner',
    metadata: '{"mode":"work"}',
    is_generating: false,
    is_favorited: 0,
    is_incognito: 0,
    enable_artifacts: 0,
  });
  upsertToolCallApprovalSession({
    session_id: 'pi_owner_session',
    thread_id: address.threadId,
    assistant_message_id: 'pi_owner_message',
    provider_type: 'custom-openai',
    model: 'pi-model',
    system_prompt: '',
    enabled_tools: JSON.stringify([TOOL_NAME]),
    available_skill_ids: '[]',
    workspace_selection: null,
  });
  defaultToolRegistry.register(
    createTool({
      name: TOOL_NAME,
      type: 'fs',
      description: 'owner probe',
      paramSchema: z.object({ path: z.string() }),
      handler: async args => {
        executions.push(args.path);
        return `contents of ${args.path}`;
      },
    })
  );
});

afterAll(async () => {
  defaultToolRegistry.remove(TOOL_NAME);
  closeDatabase();
  await fs.rm(root, { recursive: true, force: true });
});

describe('pi tool resume through the real five-state owner (switch item 3b)', () => {
  beforeEach(() => {
    executions.length = 0;
  });

  it('approved call: owner admits, executes exactly once, records the facts; replay joins the record', async () => {
    upsertToolCallApprovals([
      {
        approval_id: address.approvalId,
        session_id: 'pi_owner_session',
        tool_call_id: 'call_owner',
        tool_name: TOOL_NAME,
        tool_args: JSON.stringify({ path: '/owner.txt' }),
        state: 'pending',
      },
    ]);
    answerToolCallApproval(address.approvalId, 'approved', 'integration approval');
    // The real flow records the decision as a session fact alongside the row
    // answer — the owner reads the reason from the event.
    recordSessionEvents(address.threadId, [
      {
        type: 'approval_decided',
        version: SESSION_EVENT_VERSION,
        payload: { approvalId: address.approvalId, approved: true, reason: 'integration approval', source: 'user' },
      },
    ]);

    const harness = buildHarness([{ approvalId: address.approvalId, toolCallId: 'call_owner' }]);
    const events = await collect(harness);

    const steps = events.filter(e => e.event === 'step').map(e => e.step);
    expect(steps[0]).toMatchObject({
      type: 'tool_execution_start',
      toolCallId: 'call_owner',
      toolName: TOOL_NAME,
      input: { path: '/owner.txt' },
    });
    expect(steps[1]).toMatchObject({
      type: 'tool_execution_end',
      outcome: 'success',
      output: { type: 'text', value: 'contents of /owner.txt' },
    });

    // Exactly once, with the bound args from the approval row.
    expect(executions).toEqual(['/owner.txt']);

    // The owner's execution facts are session-log records.
    const factTypes = getSessionEvents(address.threadId, [
      TOOL_EXECUTION_PREPARED,
      TOOL_EXECUTION_STARTED,
      TOOL_EXECUTION_FINISHED,
    ]).map(e => e.type);
    expect(factTypes).toEqual([TOOL_EXECUTION_PREPARED, TOOL_EXECUTION_STARTED, TOOL_EXECUTION_FINISHED]);

    // The mirror: user, assistant(tool-call), tool(result), assistant(done)
    // — the tool result sits between the paused exchange and the continuation.
    const history = harness.getHistory();
    expect(history[2]).toMatchObject({ role: 'tool' });
    expect(history.at(-1)).toMatchObject({ role: 'assistant' });

    // Replay: a SECOND resume of the same approval joins the owner's
    // recorded result — no second effect.
    const replayHarness = buildHarness([{ approvalId: address.approvalId, toolCallId: 'call_owner' }]);
    const replayEvents = await collect(replayHarness);
    const replaySteps = replayEvents.filter(e => e.event === 'step').map(e => e.step);
    expect(replaySteps[1]).toMatchObject({
      type: 'tool_execution_end',
      outcome: 'success',
      output: { type: 'text', value: 'contents of /owner.txt' },
    });
    expect(executions).toEqual(['/owner.txt']);
  });

  it('rejected call: the owner canonical denial, zero effects', async () => {
    const rejectedApprovalId = 'ap_owner_rejected';
    upsertToolCallApprovals([
      {
        approval_id: rejectedApprovalId,
        session_id: 'pi_owner_session',
        tool_call_id: 'call_owner_rejected',
        tool_name: TOOL_NAME,
        tool_args: JSON.stringify({ path: '/rejected.txt' }),
        state: 'pending',
      },
    ]);
    answerToolCallApproval(rejectedApprovalId, 'rejected', 'integration rejection');
    recordSessionEvents(address.threadId, [
      {
        type: 'approval_decided',
        version: SESSION_EVENT_VERSION,
        payload: { approvalId: rejectedApprovalId, approved: false, reason: 'integration rejection', source: 'user' },
      },
    ]);

    const harness = buildHarness([{ approvalId: rejectedApprovalId, toolCallId: 'call_owner_rejected' }]);
    const events = await collect(harness);

    const steps = events.filter(e => e.event === 'step').map(e => e.step);
    expect(steps[1]).toMatchObject({
      type: 'tool_execution_end',
      outcome: 'error',
      output: { type: 'execution-denied', reason: 'integration rejection' },
    });
    expect(executions).toEqual([]);
  });
});
