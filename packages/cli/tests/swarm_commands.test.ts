import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { setPlatformInfo } from '@iki/core/platform';
import { wirePlatformContext } from '@iki/core/platform_wiring';
import { initializeDatabase } from '@iki/store/database';
import { createChatService, createThreadMailbox } from '@iki/harness/thread_session';
import { createSwarmManager } from '@iki/harness/swarm';
import {
  buildSlashCommands,
  executeSlashCommand,
  type InteractiveCliState,
  type UsageTotals,
} from '../src/commands';
import { formatToolCallPending } from '../src/tool_render';

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('CLI /swarm slash commands and rendering', () => {
  it('starts a swarm, inspects status/board, posts/steers, and renders swarm tool cards', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iki-cli-swarm-'));
    tempDirs.push(dataDir);
    wirePlatformContext();
    setPlatformInfo({ userDataPath: dataDir });
    initializeDatabase();

    const chatService = createChatService();
    chatService.createThread({
      id: 'cli_coord',
      title: 'CLI Test',
      provider_type: 'openai',
      model: 'gpt-test',
    });

    const mailbox = createThreadMailbox({
      chat: {
        stream: async () => ({ success: true, text: 'worker done' }),
        pushSteerByThread: () => false,
        cancelThreadStreams: () => undefined,
        isThreadRunning: () => false,
      },
    });
    const swarmManager = createSwarmManager({
      chatService,
      mailbox,
      getBuiltinTools: () => ['bash', 'job'],
    });

    const state: InteractiveCliState = {
      chatService,
      swarmManager,
      dataDir,
      threadId: 'cli_coord',
      providerType: 'openai',
      model: 'gpt-test',
      skillMode: 'auto',
    };
    const totals: UsageTotals = {
      turns: 0,
      uncachedInputTokens: 0,
      cacheReadTokens: 0,
      outputTokens: 0,
    };

    const cmds = buildSlashCommands(state);
    expect(cmds.some(c => c.name === 'swarm')).toBe(true);

    // `/swarm <task>` starts swarm and instructs REPL to run coordinator turn
    const startOutcome = await executeSlashCommand('/swarm build parser and tests', state, totals);
    expect(startOutcome).toMatchObject({
      kind: 'run-swarm',
      prompt: 'build parser and tests',
      created: true,
    });

    // Spawn a worker so we can test status/board/steer/kill
    await swarmManager.add({
      callerThreadId: 'cli_coord',
      name: 'docs',
      brief: 'Write docs',
      workspace: 'inherit',
    });
    await swarmManager.waitForIdle((startOutcome as { swarmId: string }).swarmId);

    const statusOutcome = await executeSlashCommand('/swarm status', state, totals);
    expect(statusOutcome.kind).toBe('handled');
    if (statusOutcome.kind === 'handled') {
      expect(statusOutcome.lines.join('\n')).toContain('@coordinator');
      expect(statusOutcome.lines.join('\n')).toContain('@docs');
    }

    const boardOutcome = await executeSlashCommand('/swarm board 5', state, totals);
    expect(boardOutcome.kind).toBe('handled');
    if (boardOutcome.kind === 'handled') {
      expect(boardOutcome.lines.join('\n')).toContain('Write docs');
    }

    const steerOutcome = await executeSlashCommand('/swarm steer docs focus on API', state, totals);
    expect(steerOutcome.kind).toBe('handled');
    await swarmManager.waitForIdle((startOutcome as { swarmId: string }).swarmId);

    const killOutcome = await executeSlashCommand('/swarm kill all', state, totals);
    expect(killOutcome.kind).toBe('handled');
    if (killOutcome.kind === 'handled') {
      expect(killOutcome.lines.join('\n')).toContain('@docs');
    }

    const card = formatToolCallPending('swarm', {
      action: 'add',
      name: 'parser',
      workspace: 'share',
      brief: 'Build parser module',
    });
    expect(card).toContain('swarm');
    expect(card).toContain('@parser');
    expect(card).toContain('share');
  });

  it('catches /compact errors cleanly and validates/resolves /skills short names', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iki-cli-skills-'));
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iki-cli-ws-'));
    tempDirs.push(dataDir, workspaceDir);
    wirePlatformContext();
    setPlatformInfo({ userDataPath: dataDir });
    initializeDatabase();

    const longDesc = 'Long skill description '.repeat(12).trim();
    const skillDir = path.join(workspaceDir, '.agents', 'skills', 'arch-guard');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      `---\nname: arch-guard\ndescription: ${longDesc}\n---\nBody`,
      'utf8'
    );

    const chatService = createChatService();
    chatService.compactThread = async () => {
      throw new Error('Context compaction failed; original history has been preserved.');
    };

    const state: InteractiveCliState = {
      chatService,
      dataDir,
      threadId: 'cli_compact_err',
      providerType: 'openai',
      model: 'gpt-test',
      workspace: workspaceDir,
      skillMode: 'auto',
    };
    const totals: UsageTotals = {
      turns: 0,
      uncachedInputTokens: 0,
      cacheReadTokens: 0,
      outputTokens: 0,
    };

    // /compact error must be caught and rendered cleanly rather than crashing CLI
    const compactOut = await executeSlashCommand('/compact', state, totals);
    expect(compactOut.kind).toBe('handled');
    if (compactOut.kind === 'handled') {
      expect(compactOut.lines.join('\n')).toContain('Compaction failed:');
    }

    // /skills list clips overly long single-line descriptions
    const listOut = await executeSlashCommand('/skills', state, totals);
    expect(listOut.kind).toBe('handled');
    if (listOut.kind === 'handled') {
      const line = listOut.lines.find(l => l.includes('agent:arch-guard')) ?? '';
      expect(line).toContain('...');
      expect(line.length).toBeLessThan(140);
    }

    // Unknown skill must not mutate state.skills or flip skillMode
    const badPin = await executeSlashCommand('/skills nonexistent-skill', state, totals);
    expect(badPin.kind).toBe('handled');
    if (badPin.kind === 'handled') {
      expect(badPin.lines.join('\n')).toContain('Unknown skill "nonexistent-skill"');
    }
    expect(state.skillMode).toBe('auto');
    expect(state.skills).toBeUndefined();

    // Short name resolves to full prefixed skill id
    const goodPin = await executeSlashCommand('/skills arch-guard', state, totals);
    expect(goodPin.kind).toBe('handled');
    if (goodPin.kind === 'handled') {
      expect(goodPin.lines.join('\n')).toContain('Pinned skills: agent:arch-guard');
    }
    expect(state.skillMode).toBe('manual');
    expect(state.skills).toEqual(['agent:arch-guard']);
  });
});
