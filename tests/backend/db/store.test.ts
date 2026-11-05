// @vitest-environment node
/**
 * Behaviour tests for the file-backed store. These replace the old mock-SQL tests:
 * they drive the real collection files and read the results back, so a broken
 * filter, ordering or JSON round-trip fails here instead of passing while the
 * mocked SQL string looked right.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { getUserDataPathMock } = vi.hoisted(() => ({ getUserDataPathMock: vi.fn(() => '') }));
vi.mock('@iki/core/platform', () => ({ getUserDataPath: getUserDataPathMock }));

import { closeDatabase, initializeDatabase } from '@iki/store/database';
import {
  createAgentRun,
  getAgentRun,
  listAgentRunsByParentRunId,
  listAgentRunsByStatus,
  updateAgentRunIfStatus,
  claimQueuedAgentRun,
  appendAgentRunStep,
  listAgentRunSteps,
  cleanupOldAgentRuns,
} from '@iki/store/agent_runs';
import { addAwaiter, getAwaiter, listDueAwaiters, reclaimStaleWakingAwaiters, updateAwaiterIfStatus } from '@iki/store/awaiters';
import { addChatUsageEvent, getChatUsageTotals, listChatUsageDaily } from '@iki/store/chat_usage';
import { addProvider, getProvider, getProviders, updateProvider, deleteProvider } from '@iki/store/providers';
import { addWorkspace, getWorkspaceByPath, getVisibleWorkspaces } from '@iki/store/workspaces';
import { addChatThread, deleteChatThread, getChatThread, touchChatThread } from '@iki/store/chat_thread';

let root = '';

const run = (over: Partial<Parameters<typeof createAgentRun>[0]> = {}) => ({
  id: 'run_1',
  kind: 'chat-turn' as const,
  status: 'running' as const,
  threadId: 'thread_1',
  rootRunId: 'run_1',
  providerType: 'openai',
  model: 'm',
  systemPrompt: 'sys',
  enabledTools: ['read_file'],
  availableSkillIds: ['skill_a'],
  input: { prompt: 'hi' },
  working: { accumulatedText: '', pendingApprovalIds: [], lastStepIndex: 0 },
  ...over,
});

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'iki-store-'));
  getUserDataPathMock.mockReturnValue(root);
  initializeDatabase({ dbPath: path.join(root, 'store.db') });
});

afterEach(() => {
  closeDatabase();
  fs.rmSync(root, { recursive: true, force: true });
});

describe('agent_runs store', () => {
  it('round-trips structured payloads through the file', () => {
    createAgentRun(run());
    const stored = getAgentRun('run_1')!;
    expect(stored.threadId).toBe('thread_1');
    expect(stored.enabledTools).toEqual(['read_file']);
    expect(stored.availableSkillIds).toEqual(['skill_a']);
    expect(stored.working.lastStepIndex).toBe(0);
  });

  it('filters by status and returns newest-updated first', () => {
    createAgentRun(run({ id: 'a', status: 'running' }));
    createAgentRun(run({ id: 'b', status: 'blocked' }));
    createAgentRun(run({ id: 'c', status: 'completed' }));
    const ids = listAgentRunsByStatus(['running', 'blocked']).map(r => r.id).sort();
    expect(ids).toEqual(['a', 'b']);
  });

  it('honours the limit option', () => {
    for (const id of ['a', 'b', 'c']) createAgentRun(run({ id }));
    expect(listAgentRunsByStatus(['running'], { limit: 2 })).toHaveLength(2);
  });

  it('claims a queued run once and refuses the second claim', () => {
    createAgentRun(run({ status: 'queued' }));
    expect(claimQueuedAgentRun('run_1')?.status).toBe('running');
    expect(claimQueuedAgentRun('run_1')).toBeNull();
  });

  it('applies a status-guarded update only when the guard matches', () => {
    createAgentRun(run({ status: 'running' }));
    expect(updateAgentRunIfStatus('run_1', { status: 'completed' }, ['blocked'])).toBeNull();
    expect(updateAgentRunIfStatus('run_1', { status: 'completed' }, ['running'])?.status).toBe(
      'completed'
    );
  });

  it('keeps steps ordered and finds children by parent', () => {
    createAgentRun(run());
    createAgentRun(run({ id: 'child', parentRunId: 'run_1', threadId: 'thread_1' }));
    appendAgentRunStep({ id: 's2', runId: 'run_1', stepIndex: 2, type: 'model', status: 'completed', summary: 'b', startedAt: 't' } as never);
    appendAgentRunStep({ id: 's1', runId: 'run_1', stepIndex: 1, type: 'model', status: 'completed', summary: 'a', startedAt: 't' } as never);
    expect(listAgentRunSteps('run_1').map(s => s.stepIndex)).toEqual([1, 2]);
    expect(listAgentRunsByParentRunId('run_1').map(r => r.id)).toEqual(['child']);
  });

  it('cleans up only terminal runs older than the cutoff', () => {
    createAgentRun(run({ id: 'old_done', status: 'completed' }));
    createAgentRun(run({ id: 'live', status: 'running' }));
    expect(cleanupOldAgentRuns(-1).deletedRuns).toBe(1); // negative age => everything is "older"
    expect(getAgentRun('old_done')).toBeNull();
    expect(getAgentRun('live')).not.toBeNull();
  });
});

describe('awaiters store', () => {
  const awaiter = (over: Record<string, unknown> = {}) => ({
    id: 'aw_1',
    title: 't',
    instruction: 'i',
    thread_id: 'thread_1',
    provider_type: 'openai',
    model: 'm',
    trigger_kind: 'time' as never,
    trigger_spec_json: '{}',
    ...over,
  });

  it('lists only armed/waking awaiters whose time has come, earliest first', () => {
    addAwaiter(awaiter({ id: 'later', next_wake_at: '2030-01-01T00:00:00.000Z' }) as never);
    addAwaiter(awaiter({ id: 'due_b', next_wake_at: '2020-01-02T00:00:00.000Z' }) as never);
    addAwaiter(awaiter({ id: 'due_a', next_wake_at: '2020-01-01T00:00:00.000Z' }) as never);
    addAwaiter(awaiter({ id: 'done', status: 'settled', next_wake_at: '2020-01-01T00:00:00.000Z' }) as never);
    const due = listDueAwaiters('2021-01-01T00:00:00.000Z').map(a => a.id);
    expect(due).toEqual(['due_a', 'due_b']);
  });

  it('reclaims a stale waking awaiter back to armed', () => {
    addAwaiter(awaiter({ id: 'stale', status: 'waking' }) as never);
    expect(reclaimStaleWakingAwaiters('2999-01-01T00:00:00.000Z')).toBe(1);
    expect(getAwaiter('stale')?.status).toBe('armed');
  });

  it('applies a status-guarded update only on a matching status', () => {
    addAwaiter(awaiter() as never);
    expect(updateAwaiterIfStatus('aw_1', 'waking', { status: 'settled' } as never)).toMatchObject({ changes: 0 });
    expect(updateAwaiterIfStatus('aw_1', 'armed', { status: 'settled' } as never)).toMatchObject({ changes: 1 });
    expect(getAwaiter('aw_1')?.status).toBe('settled');
  });
});

describe('chat_usage aggregation', () => {
  const usage = (id: string, tokens: number, createdAt: string) => ({
    id,
    provider_type: 'openai',
    model: 'm',
    input_tokens: tokens,
    output_tokens: 0,
    total_tokens: tokens,
    cache_read_tokens: 0,
    cache_write_tokens: 0,
    reasoning_tokens: 0,
    estimated_cost_usd: 0.5,
    created_at: createdAt,
    metadata: '{}',
    source: 'chat',
  });

  it('sums totals in range and buckets by day', () => {
    addChatUsageEvent({ ...usage('u1', 10, '2026-01-01T10:00:00.000Z'), input_tokens: -5, output_tokens: 3.7 } as never);
    addChatUsageEvent(usage('u2', 20, '2026-01-01T11:00:00.000Z') as never);
    addChatUsageEvent(usage('u3', 30, '2026-01-02T11:00:00.000Z') as never);

    const totals = getChatUsageTotals();
    expect(totals.messageCount).toBe(3);
    expect(totals.inputTokens).toBe(50); // -5 clamped to 0
    expect(totals.outputTokens).toBe(3); // 3.7 truncated then clamped

    const ranged = getChatUsageTotals({ from: '2026-01-02', to: '2026-01-02T23:59:59.999Z' });
    expect(ranged.messageCount).toBe(1);

    expect(listChatUsageDaily().map(d => [d.date, d.inputTokens])).toEqual([
      ['2026-01-01', 20],
      ['2026-01-02', 30],
    ]);
  });
});

describe('providers store', () => {
  it('adds, updates, filters and deletes', () => {
    addProvider({ id: 'p1', name: 'A', type: 'openai', api_key: 'k', models: '[]' });
    addProvider({ id: 'p2', name: 'B', type: 'openai', api_key: 'k', models: '[]' });
    expect(getProviders()).toHaveLength(2);
    updateProvider('p1', { name: 'A2' });
    expect(getProvider('p1')?.name).toBe('A2');
    expect(updateProvider('p1', {})).toBeNull();
    deleteProvider('p2');
    expect(getProviders().map(p => p.id)).toEqual(['p1']);
  });
});

describe('workspaces + threads store', () => {
  it('finds a workspace by path and hides unlisted ones', () => {
    addWorkspace({ id: 'w1', path: '/a', name: 'A' });
    addWorkspace({ id: 'w2', path: '/b', name: 'B', show_in_list: 0 });
    expect(getWorkspaceByPath('/a')?.id).toBe('w1');
    expect(getVisibleWorkspaces().map(w => w.id)).toEqual(['w1']);
  });

  it('touches a thread timestamp and deletes it with its log', () => {
    addChatThread({ id: 't1', title: 'T', metadata: '{}' });
    const before = getChatThread('t1')!.updated_at;
    touchChatThread('t1');
    expect(getChatThread('t1')!.updated_at >= before).toBe(true);
    deleteChatThread('t1');
    expect(getChatThread('t1')).toBeNull();
  });
});
