// @vitest-environment node
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { closeDatabase, initializeDatabase } from '@iki/store/database';
import { addWorkspace } from '@iki/store/workspaces';
import * as agentRunDb from '@iki/store/agent_runs';
import {
  INPUT_ACCEPTED,
  MODEL_OUTPUT_COMMITTED,
  APPROVAL_REQUESTED,
  TURN_STARTED,
  SESSION_EVENT_VERSION,
  rebuildThreadViewFromEvents,
  recordSessionEvents,
} from '@iki/backend/thread_session/session_log';
import { recoverStuckRunsOnStartup } from '@iki/backend/thread_session/run_recovery';

/**
 * Restart recovery must SETTLE a call that was waiting for approval, in place.
 *
 * The card the user saw before the crash belongs to a decision that can no longer be
 * made: the approval session died with the process (ADR-011). Recovery used to append
 * a terminal error part beside the pending one, so the transcript carried two parts
 * for the same toolCallId — the model saw "never executed" (good) and the renderer
 * still rendered a live Approve button (the e2e's zombie). One part per call is the
 * invariant asserted here, plus that a second recovery pass changes nothing.
 */
describe('restart recovery closes the pending approval in the transcript', () => {
  let root: string;
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'iki-repro-'));
    initializeDatabase({ dbPath: path.join(root, 'r.db') });
    addWorkspace({ id: 'ws', path: root, name: 'r' });
  });
  afterEach(async () => { closeDatabase(); await fs.rm(root, { recursive: true, force: true }); });

  it('leaves exactly one part for the interrupted call', () => {
    agentRunDb.createAgentRun({
      id: 'run_blocked', kind: 'chat-turn', status: 'blocked', threadId: 'thread_r',
      rootRunId: 'run_blocked', providerType: 'openai', model: 'm', systemPrompt: 's',
      enabledTools: ['write_file'], availableSkillIds: [],
      input: { prompt: 'go', messages: [], metadata: {} },
      working: { accumulatedText: '', pendingApprovalIds: ['ap_1'], lastStepIndex: 0 },
      output: null, error: null,
    } as never);

    recordSessionEvents('thread_r', [
      { type: INPUT_ACCEPTED, version: SESSION_EVENT_VERSION, payload: { messageId: 'u1', message: { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'go' }] } } },
      { type: TURN_STARTED, version: SESSION_EVENT_VERSION, payload: { runId: 'run_blocked', kind: 'chat-turn' } },
      { type: MODEL_OUTPUT_COMMITTED, version: SESSION_EVENT_VERSION, payload: { runId: 'run_blocked', messageId: 'a1', message: { id: 'a1', role: 'assistant', parts: [
        { type: 'text', text: 'working', state: 'done' },
        { type: 'dynamic-tool', toolCallId: 'call_1', toolName: 'write_file', state: 'approval-requested', input: {}, approval: { id: 'ap_1' } },
      ] } } },
      { type: APPROVAL_REQUESTED, version: SESSION_EVENT_VERSION, payload: { approvalId: 'ap_1', runId: 'run_blocked', sessionId: 'a1', toolCallId: 'call_1', toolName: 'write_file', args: {} } },
    ]);

    expect(recoverStuckRunsOnStartup()).toMatchObject({ blockedRuns: 1, interruptedToolParts: 1 });

    const assistant = rebuildThreadViewFromEvents('thread_r').messages.find(m => m.id === 'a1')!;

    const forCall = assistant.parts.filter(
      p => (p as { toolCallId?: string }).toolCallId === 'call_1'
    );
    expect(forCall).toHaveLength(1);
    expect((forCall[0] as { state?: string }).state).toBe('output-error');
    expect((forCall[0] as { errorText?: string }).errorText).toContain('never executed');
    // The rest of the message survives the settle.
    expect(assistant.parts.filter(p => (p as { type?: string }).type === 'text')).toHaveLength(1);

    // Recovery is idempotent: a second pass sees a terminal part and writes nothing.
    const before = rebuildThreadViewFromEvents('thread_r').events.length;
    expect(recoverStuckRunsOnStartup().interruptedToolParts).toBe(0);
    expect(rebuildThreadViewFromEvents('thread_r').events.length).toBe(before);
  });
});
