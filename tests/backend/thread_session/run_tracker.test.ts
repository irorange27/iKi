// @vitest-environment node

/**
 * The run tracker moves a run row through its lifecycle and records the steps
 * that happened. This asserts the rows a caller can read afterwards, not the
 * arguments handed to the writer functions.
 *
 * The previous version rebuilt a fake database out of `vi.fn()` stand-ins for
 * createAgentRun / updateAgentRun / appendAgentRunStep and asserted the shape
 * of what reached `appendAgentRunStep`. It broke on every writer signature
 * change and could pass while the stored rows were wrong, because nothing read
 * them back. A real on-disk database costs the same to set up.
 *
 * Not asserted on purpose: which function wrote a row, in what order, how many
 * times. A refused transition is observable as the row keeping its old state.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeDatabase, initializeDatabase } from '@iki/backend/db/database';
import { createAgentRun, getAgentRun, listAgentRunSteps } from '@iki/backend/db/agent_runs';
import { createAgentRunTracker } from '@iki/backend/thread_session/run_tracker';

const created: string[] = [];

beforeAll(() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'run-tracker-'));
  created.push(dir);
  initializeDatabase({ dbPath: path.join(dir, 'tracker.db') });
});

afterAll(() => {
  closeDatabase();
  for (const dir of created.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

let runCounter = 0;

/**
 * Store a parent run and return the ids a child tracker needs.
 *
 * The parent's root id is deliberately NOT its own id: a child must inherit
 * `rootRunId`, and if the two were equal the assertion could not tell
 * inheritance from "use the parent id". A run that started a successor has
 * exactly this shape.
 */
const seedParent = () => {
  runCounter += 1;
  const parentId = `run_parent_${runCounter}`;
  const chainRootId = `run_chain_root_${runCounter}`;
  const threadId = `thread_${runCounter}`;
  createAgentRun({
    id: parentId,
    kind: 'chat-turn',
    status: 'running',
    threadId,
    rootRunId: chainRootId,
    providerType: 'openai',
    model: 'gpt-4o-mini',
    systemPrompt: 'system prompt',
    enabledTools: [],
    availableSkillIds: [],
    input: { prompt: 'Inspect files' },
    working: { accumulatedText: '', pendingApprovalIds: [], lastStepIndex: 0 },
  } as never);
  return { parentId, threadId, chainRootId };
};

const buildTracker = (params: {
  parentId: string;
  threadId: string;
  working?: { accumulatedText: string; pendingApprovalIds: string[]; lastStepIndex: number };
}) =>
  createAgentRunTracker({
    kind: 'delegated-agent',
    threadId: params.threadId,
    parentRunId: params.parentId,
    providerType: 'openai',
    model: 'gpt-4o-mini',
    systemPrompt: 'system prompt',
    enabledTools: ['list_dir'],
    availableSkillIds: [],
    input: { prompt: 'Inspect files', metadata: { source: 'delegated-agent' } },
    working: params.working ?? {
      accumulatedText: '',
      pendingApprovalIds: [],
      lastStepIndex: 0,
    },
  });

describe('agent run tracker', () => {
  it('creates a run that inherits the chain root id, and records a model step', () => {
    const { parentId, threadId, chainRootId } = seedParent();
    const tracker = buildTracker({ parentId, threadId });

    const stored = getAgentRun(tracker.id);
    expect(stored).not.toBeNull();
    expect(stored!.rootRunId).toBe(chainRootId);
    expect(stored!.parentRunId).toBe(parentId);

    tracker.recordModelStep({
      messages: [{ role: 'user', content: 'Inspect files' }],
      systemPrompt: 'system prompt',
      content: [{ type: 'tool-call', toolCallId: 'call_1', toolName: 'list_dir' }],
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    } as never);

    const steps = listAgentRunSteps(tracker.id);
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({ type: 'model', status: 'completed', stepIndex: 1 });
    expect(getAgentRun(tracker.id)!.working.lastStepIndex).toBe(1);
  });

  it('refuses a status transition out of a terminal run, leaving the row completed', () => {
    const { parentId, threadId } = seedParent();
    const tracker = buildTracker({ parentId, threadId });

    tracker.markCompleted({ text: 'done' });
    expect(getAgentRun(tracker.id)!.status).toBe('completed');

    expect(() => tracker.markFailed({ message: 'late failure' })).toThrow(
      'Invalid agent run status transition: completed -> failed'
    );

    const after = getAgentRun(tracker.id)!;
    expect(after.status).toBe('completed');
    expect(after.error).toBeNull();
  });

  it('records an approval response once per approval id', () => {
    const { parentId, threadId } = seedParent();
    const tracker = buildTracker({
      parentId,
      threadId,
      working: { accumulatedText: '', pendingApprovalIds: ['approval_1'], lastStepIndex: 0 },
    });

    const response = {
      approvalId: 'approval_1',
      toolCallId: 'call_1',
      approved: false,
      reason: 'Denied by user',
    };
    tracker.recordApprovalResponse(response as never);
    // A resumed turn re-delivers decisions it already recorded; the second one
    // must not add a second step.
    tracker.recordApprovalResponse(response as never);

    const steps = listAgentRunSteps(tracker.id).filter(
      step => step.type === 'approval-response'
    );
    expect(steps).toHaveLength(1);
    expect(steps[0]!.input).toMatchObject({
      approvalId: 'approval_1',
      approved: false,
      reason: 'Denied by user',
    });
  });
});
