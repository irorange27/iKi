// @vitest-environment node

import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const { getUserDataPathMock } = vi.hoisted(() => ({
  getUserDataPathMock: vi.fn(() => ''),
}));

vi.mock('@iki/backend/platform', () => ({
  getUserDataPath: getUserDataPathMock,
}));

const chatDb = await import('@iki/backend/db/chat_thread');
const agentRunDb = await import('@iki/backend/db/agent_runs');
const database = await import('@iki/backend/db/database');

const { createChatRuns } = await import('@iki/backend/thread_session/runs');

let dataDir = '';

const createRun = (overrides: Record<string, unknown>) => {
  const id = overrides.id as string;
  agentRunDb.createAgentRun({
    id,
    kind: 'proactive-task',
    status: 'completed',
    threadId: 'thread_review_1',
    rootRunId: id,
    providerType: 'openai',
    model: 'gpt-test',
    systemPrompt: '',
    enabledTools: [],
    availableSkillIds: [],
    input: { messages: [], metadata: { source: 'proactive-task', taskId: 'task_1', reason: 'schedule' } },
    working: { modelMessages: [], accumulatedText: '', pendingApprovalIds: [], lastStepIndex: 0 },
    output: null,
    error: null,
    ...overrides,
  });
};

describe('listReviewQueue', () => {
  beforeAll(async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), 'iki-review-'));
    getUserDataPathMock.mockReturnValue(dataDir);
    database.initializeDatabase({ dbPath: path.join(dataDir, 'test.db') });

    chatDb.addChatThread({ id: 'thread_review_1', title: 'Automation thread', metadata: '{}' });
  });

  afterAll(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  it('returns only finished background runs mapped for review', async () => {
    const now = new Date().toISOString();
    createRun({
      id: 'run_ok',
      status: 'completed',
      createdAt: now,
      updatedAt: now,
      working: {
        modelMessages: [],
        accumulatedText: 'Summary of what the agent did.',
        pendingApprovalIds: [],
        lastStepIndex: 0,
      },
    });
    createRun({
      id: 'run_failed',
      status: 'failed',
      createdAt: now,
      updatedAt: now,
      output: { text: '', finishReason: 'error' },
      error: { message: 'Provider exploded' },
    });
    createRun({ id: 'run_running', status: 'running', createdAt: now, updatedAt: now });
    createRun({
      id: 'run_chat',
      kind: 'chat-turn',
      status: 'completed',
      createdAt: now,
      updatedAt: now,
    });

    const runs = createChatRuns({ abortActiveStream: vi.fn() });
    const items = runs.listReviewQueue();

    const ids = items.map(item => item.runId);
    expect(ids).toContain('run_ok');
    expect(ids).toContain('run_failed');
    expect(ids).not.toContain('run_running');
    expect(ids).not.toContain('run_chat');

    const ok = items.find(item => item.runId === 'run_ok')!;
    expect(ok.threadTitle).toBe('Automation thread');
    expect(ok.taskName).toBe('task_1'); // falls back to the raw id when the task row is gone
    expect(ok.summary).toBe('Summary of what the agent did.');

    const failed = items.find(item => item.runId === 'run_failed')!;
    expect(failed.error).toBe('Provider exploded');
  });

  it('truncates long summaries', async () => {
    const now = new Date().toISOString();
    createRun({
      id: 'run_long',
      status: 'completed',
      createdAt: now,
      updatedAt: now,
      working: {
        modelMessages: [],
        accumulatedText: 'x'.repeat(500),
        pendingApprovalIds: [],
        lastStepIndex: 0,
      },
    });

    const runs = createChatRuns({ abortActiveStream: vi.fn() });
    const item = runs.listReviewQueue().find(entry => entry.runId === 'run_long');
    expect(item?.summary.length).toBeLessThanOrEqual(281);
    expect(item?.summary.endsWith('…')).toBe(true);
  });
});
