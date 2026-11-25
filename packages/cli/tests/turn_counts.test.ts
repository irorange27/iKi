import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { setPlatformInfo } from '@iki/core/platform';
import { wirePlatformContext } from '@iki/core/platform_wiring';
import { initializeDatabase } from '@iki/store/database';
import { createAgentRunTracker } from '@iki/harness/thread_session/run_tracker';
import {
  recordSessionEvents,
  turnFactsToEvents,
} from '@iki/harness/thread_session/session_log';
import { persistThreadRuntimeHints } from '@iki/harness/turn_prep/thread_hints';
import * as chatThreadDb from '@iki/store/chat_thread';
import { countThreadTurnsAndSteps, resolveThreadDisplayTitle } from '../src/commands';

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('countThreadTurnsAndSteps', () => {
  it('counts persisted thread user turns and only model-inference steps (excluding tool-call/tool-result audit steps)', () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iki-turn-counts-'));
    tempDirs.push(dataDir);
    wirePlatformContext();
    setPlatformInfo({ userDataPath: dataDir });
    initializeDatabase();

    // Thread A: 2 user turns, where turn 1 ran 2 model steps + 1 tool call + 1 tool result
    const tracker1 = createAgentRunTracker({
      kind: 'chat-turn',
      threadId: 'thread_a',
      providerType: 'openai',
      model: 'gpt-test',
      systemPrompt: '',
      enabledTools: ['bash'],
      availableSkillIds: [],
      input: { prompt: 'turn 1' },
      working: { accumulatedText: '', pendingApprovalIds: [], lastStepIndex: 0 },
    });
    recordSessionEvents(
      'thread_a',
      turnFactsToEvents({
        input: {
          messageId: 'u1',
          message: { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'turn 1' }] },
        },
        started: { runId: tracker1.id, kind: 'chat-turn' },
      })
    );
    tracker1.recordModelStep({ content: [{ type: 'text', text: 'calling bash' }], finishReason: 'tool-calls' });
    tracker1.recordAgentStep({
      type: 'tool_execution_start',
      toolCallId: 'tc1',
      toolName: 'bash',
      input: { command: 'ls' },
    });
    tracker1.recordAgentStep({
      type: 'tool_execution_end',
      toolCallId: 'tc1',
      outcome: 'success',
      output: 'README.md',
    });
    tracker1.recordModelStep({ content: [{ type: 'text', text: 'done' }], finishReason: 'stop' });

    const tracker2 = createAgentRunTracker({
      kind: 'chat-turn',
      threadId: 'thread_a',
      providerType: 'openai',
      model: 'gpt-test',
      systemPrompt: '',
      enabledTools: ['bash'],
      availableSkillIds: [],
      input: { prompt: 'turn 2' },
      working: { accumulatedText: '', pendingApprovalIds: [], lastStepIndex: 0 },
    });
    recordSessionEvents(
      'thread_a',
      turnFactsToEvents({
        input: {
          messageId: 'u2',
          message: { id: 'u2', role: 'user', parts: [{ type: 'text', text: 'turn 2' }] },
        },
        started: { runId: tracker2.id, kind: 'chat-turn' },
      })
    );
    tracker2.recordModelStep({ content: [{ type: 'text', text: 'second reply' }], finishReason: 'stop' });

    // Even though tracker1.working.lastStepIndex is 4 (model + tool-call + tool-result + model)
    // and tracker2 is 1 (total 5 audit steps), actual model steps across both turns is 3.
    expect(countThreadTurnsAndSteps('thread_a')).toEqual({ turns: 2, steps: 3 });

    // Switching to a fresh thread immediately reports 0/0 instead of leaking prior thread turns
    expect(countThreadTurnsAndSteps('thread_fresh')).toEqual({ turns: 0, steps: 0 });
  });

  it('auto-titles placeholder threads from first user message while preserving custom titles and falling back for legacy threads', () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iki-thread-title-'));
    tempDirs.push(dataDir);
    wirePlatformContext();
    setPlatformInfo({ userDataPath: dataDir });
    initializeDatabase();

    chatThreadDb.addChatThread({ id: 't_auto', title: 'Interactive CLI', model: 'gpt-test' });
    persistThreadRuntimeHints({
      threadId: 't_auto',
      providerType: 'openai',
      model: 'gpt-test',
      firstUserPrompt: '修复 CLI 的 turn 计数显示问题\n顺便加个单测',
    });
    expect(chatThreadDb.getChatThread('t_auto')?.title).toBe('修复 CLI 的 turn 计数显示问题');

    // Second turn must not overwrite the established title
    persistThreadRuntimeHints({
      threadId: 't_auto',
      providerType: 'openai',
      model: 'gpt-test',
      firstUserPrompt: '第二句话不应该覆盖标题',
    });
    expect(chatThreadDb.getChatThread('t_auto')?.title).toBe('修复 CLI 的 turn 计数显示问题');

    // Explicit custom title is never overwritten
    chatThreadDb.addChatThread({ id: 't_custom', title: 'Release v0.2', model: 'gpt-test' });
    persistThreadRuntimeHints({
      threadId: 't_custom',
      providerType: 'openai',
      model: 'gpt-test',
      firstUserPrompt: 'hello',
    });
    expect(chatThreadDb.getChatThread('t_custom')?.title).toBe('Release v0.2');

    // Legacy thread already saved with 'Interactive CLI' falls back to first persisted user message on /resume
    chatThreadDb.addChatThread({ id: 't_legacy', title: 'Interactive CLI', model: 'gpt-test' });
    recordSessionEvents(
      't_legacy',
      turnFactsToEvents({
        input: {
          messageId: 'u_leg_1',
          message: {
            id: 'u_leg_1',
            role: 'user',
            parts: [{ type: 'text', text: '把 codex skills 改成 agent skills' }],
          },
        },
        started: { runId: 'run_leg_1', kind: 'chat-turn' },
      })
    );
    expect(resolveThreadDisplayTitle(chatThreadDb.getChatThread('t_legacy')!)).toBe(
      '把 codex skills 改成 agent skills'
    );
  });
});
