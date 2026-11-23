import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ModelMessage } from '@iki/llm/message/model_history';

vi.mock('../src/runtimes/thread_summary', () => ({
  generateThreadSummary: vi.fn(async (params: { existingSummary?: string }) => ({
    summary: params.existingSummary
      ? `${params.existingSummary}\n\n- Merged newer turn facts`
      : '## Primary Request and Intent\n- Compacted prior history',
    model: { providerType: 'openai-compatible', modelId: 'mock-summary' },
  })),
}));

import { initializeDatabase, closeDatabase } from '@iki/store/database';
import { frameCheckpoint } from '../src/runtimes/compaction_prompt';
import { preparePiTurnHistory } from '../src/agent/turn/turn_budget';
import {
  INPUT_ACCEPTED,
  MESSAGES_TRUNCATED,
  MODEL_OUTPUT_COMMITTED,
  SESSION_EVENT_VERSION,
  compactionCheckpointToEvent,
  rebuildThreadViewFromEvents,
  recordSessionEvents,
  selectMessagesForCompaction,
} from '../src/thread_session/session_log';

const tempDirs: string[] = [];

const setupStore = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'iki-compaction-test-'));
  tempDirs.push(dir);
  initializeDatabase({ dbPath: path.join(dir, 'iki.db') });
  return dir;
};

const userMsg = (id: string, text: string) => ({
  id,
  role: 'user' as const,
  parts: [{ type: 'text' as const, text }],
});

const assistantMsg = (id: string, text: string) => ({
  id,
  role: 'assistant' as const,
  parts: [{ type: 'text' as const, text }],
});

afterEach(() => {
  closeDatabase();
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('Compaction checkpoints in SessionLog and TurnBudget', () => {
  it('persists compaction checkpoints, slices model replay while preserving full UI history, and clears on anchor truncation', () => {
    setupStore();
    const threadId = 'thread-compaction-1';

    recordSessionEvents(threadId, [
      { type: INPUT_ACCEPTED, version: SESSION_EVENT_VERSION, payload: { messageId: 'u1', message: userMsg('u1', 'turn 1'), runId: 'r1' } },
      { type: MODEL_OUTPUT_COMMITTED, version: SESSION_EVENT_VERSION, payload: { messageId: 'a1', message: assistantMsg('a1', 'reply 1'), runId: 'r1', transport: 'stream' } },
      { type: INPUT_ACCEPTED, version: SESSION_EVENT_VERSION, payload: { messageId: 'u2', message: userMsg('u2', 'turn 2'), runId: 'r2' } },
      { type: MODEL_OUTPUT_COMMITTED, version: SESSION_EVENT_VERSION, payload: { messageId: 'a2', message: assistantMsg('a2', 'reply 2'), runId: 'r2', transport: 'stream' } },
      compactionCheckpointToEvent({
        runId: 'r2',
        summary: 'Summary of u1 and a1',
        firstKeptMessageId: 'u2',
        omittedCount: 2,
        keptCount: 2,
        compactedAt: '2026-11-23T00:00:00.000Z',
      }),
      { type: INPUT_ACCEPTED, version: SESSION_EVENT_VERSION, payload: { messageId: 'u3', message: userMsg('u3', 'turn 3'), runId: 'r3' } },
    ]);

    const view = rebuildThreadViewFromEvents(threadId);
    expect(view.messages.map(m => m.id)).toEqual(['u1', 'a1', 'u2', 'a2', 'u3']);
    expect(view.compaction?.summary).toBe('Summary of u1 and a1');
    expect(view.compaction?.firstKeptMessageId).toBe('u2');

    const sliced = selectMessagesForCompaction(view.messages, view.compaction);
    expect(sliced.summary).toBe('Summary of u1 and a1');
    expect(sliced.messages.map(m => m.id)).toEqual(['u2', 'a2', 'u3']);

    // Deleting the anchor message invalidates the checkpoint instead of slicing at a missing id
    recordSessionEvents(threadId, [
      {
        type: MESSAGES_TRUNCATED,
        version: SESSION_EVENT_VERSION,
        payload: {
          afterMessageId: 'a1',
          deletedMessageIds: ['u2', 'a2', 'u3'],
          truncatedAt: '2026-11-23T00:01:00.000Z',
        },
      },
    ]);
    const truncatedView = rebuildThreadViewFromEvents(threadId);
    expect(truncatedView.messages.map(m => m.id)).toEqual(['u1', 'a1']);
    expect(truncatedView.compaction).toBeUndefined();
  });

  it('merges an existing checkpoint summary without duplicating summary messages and reports firstKeptInitialIndex', async () => {
    const priorSummary: ModelMessage = {
      role: 'system',
      content: frameCheckpoint('Prior facts from turn 1'),
    };
    const m0: ModelMessage = { role: 'user', content: 'alpha beta gamma delta '.repeat(250) };
    const m1: ModelMessage = { role: 'assistant', content: 'epsilon zeta eta theta '.repeat(250) };
    const m2: ModelMessage = { role: 'assistant', content: 'recent reply to retain' };
    const m3: ModelMessage = { role: 'user', content: 'latest question' };
    const initialConversation = [m0, m1, m2, m3];

    let emittedCheckpoint:
      | { summary: string; omittedCount: number; keptCount: number; firstKeptInitialIndex: number }
      | undefined;

    const prepared = await preparePiTurnHistory({
      history: [{ role: 'system', content: 'Base system' }, priorSummary, m0, m1, m2, m3],
      personaPrompt: '',
      planPrompt: '',
      transcriptSystemText: 'Base system',
      maxInputTokens: 900,
      existingSummary: 'Prior facts from turn 1',
      previousSummaryMessage: priorSummary,
      initialConversation,
      onCompacted: checkpoint => {
        emittedCheckpoint = checkpoint;
      },
    });

    expect(emittedCheckpoint).toBeDefined();
    expect(emittedCheckpoint?.summary).toContain('Prior facts from turn 1');
    expect(emittedCheckpoint?.summary).toContain('Merged newer turn facts');
    expect(emittedCheckpoint?.firstKeptInitialIndex).toBe(2);

    const checkpointMessages = prepared.requestHistory.filter(
      msg => msg.role === 'system' && typeof msg.content === 'string' && msg.content.includes('<compacted-summary>')
    );
    expect(checkpointMessages).toHaveLength(1);

    // Follow-up turn already within budget preserves the summary without re-compacting
    let reCompacted = false;
    const followUp = await preparePiTurnHistory({
      history: prepared.requestHistory,
      personaPrompt: '',
      planPrompt: '',
      transcriptSystemText: 'Base system',
      maxInputTokens: 900,
      existingSummary: emittedCheckpoint?.summary,
      previousSummaryMessage: prepared.summaryMessage,
      initialConversation: [m2, m3],
      onCompacted: () => {
        reCompacted = true;
      },
    });
    expect(reCompacted).toBe(false);
    expect(followUp.summaryMessage).toBe(prepared.summaryMessage);
  });
});
