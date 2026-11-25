import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { setPlatformInfo } from '@iki/core/platform';
import { wirePlatformContext } from '@iki/core/platform_wiring';
import { runWithToolRuntimeContext } from '@iki/core/utils/runtime_context';
import { appendSessionFacts, getSessionEvents } from '@iki/session/session_events';
import { initializeDatabase } from '@iki/store/database';
import { createSwarmTools } from '@iki/tools/swarm';
import { createChatService, createThreadMailbox } from '../src/thread_session';
import type { ChatTurnOptions } from '../src/turn_prep/turn_preparer';
import { createSwarmManager } from '../src/swarm';
import type { ThreadWorkspaceSelection } from '../src/workspaces/thread_workspace';

const tempDirs: string[] = [];

const makeTempDir = (prefix: string): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
};

const initGitRepo = (dir: string): void => {
  execFileSync('git', ['init', '-b', 'main'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'test@iki.local'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'iKi Test'], { cwd: dir, stdio: 'ignore' });
  fs.writeFileSync(path.join(dir, 'index.ts'), 'export const v = 1;\n', 'utf8');
  execFileSync('git', ['add', 'index.ts'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['-c', 'commit.gpgsign=false', 'commit', '-m', 'init'], {
    cwd: dir,
    stdio: 'ignore',
  });
};

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('SwarmManager end-to-end orchestration', () => {
  it('supports worktree workers, sharded tasks, session fork, incremental board deltas, permissions, model switch, and guardrails', async () => {
    const dataDir = makeTempDir('iki-swarm-data-');
    const repoDir = makeTempDir('iki-swarm-repo-');
    wirePlatformContext();
    setPlatformInfo({ userDataPath: dataDir });
    initializeDatabase();
    initGitRepo(repoDir);

    const chatService = createChatService();
    chatService.createThread({
      id: 'coord_1',
      title: 'Coordinator Thread',
      provider_type: 'openai',
      model: 'model-a',
    });
    // Seed a session event on coordinator so we can verify `fork: "coordinator"`
    appendSessionFacts('coord_1', [
      { type: 'input_accepted', version: 1, payload: { runId: 'r0', text: 'seed context' } },
    ]);

    const capturedTurns: ChatTurnOptions[] = [];
    const mailbox = createThreadMailbox({
      chat: {
        stream: async (_target, options) => {
          capturedTurns.push(options);
          return { success: true, text: `ack:${options.threadId}` };
        },
        pushSteerByThread: () => false,
        cancelThreadStreams: () => undefined,
        isThreadRunning: () => false,
      },
      getMaxConcurrentActive: () => 4,
    });

    const swarmManager = createSwarmManager({
      chatService,
      mailbox,
      getBuiltinTools: () => ['bash', 'job'],
      getSettings: () => ({
        maxWorkers: 5,
        maxConcurrentActive: 4,
        maxTotalTurns: 20,
        maxMentionsPerPost: 4,
        maxPingPongHops: 2,
      }),
    });

    const parentSelection: ThreadWorkspaceSelection = {
      threadId: 'coord_1',
      workspaceId: 'ws_repo',
      workspace: {
        id: 'ws_repo',
        name: 'repo',
        path: repoDir,
        is_temporary: false,
        show_in_list: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    };

    const started = swarmManager.startSwarm({
      coordinatorThreadId: 'coord_1',
      title: 'Refactor Engine',
      providerType: 'openai',
      model: 'model-a',
      workspaceSelection: parentSelection,
    });
    expect(started.created).toBe(true);

    // SwarmControlTool must NEVER be auto-allowed on ordinary non-swarm turns
    const [swarmTool] = createSwarmTools({ getRuntime: () => swarmManager });
    expect(swarmTool.autoAllowed).toBe(false);

    // Coordinator sets title via the tool interface
    const titleOut = await runWithToolRuntimeContext({ threadId: 'coord_1' }, () =>
      swarmTool.execute({ action: 'title', title: 'Swarm Core Build' })
    );
    expect(titleOut).toMatchObject({ title: 'Swarm Core Build' });

    // Spawn a `share` worktree worker forked from coordinator
    const addWriter = await swarmManager.add({
      callerThreadId: 'coord_1',
      name: 'parser',
      brief: 'Implement parser module',
      workspace: 'share',
      fork: 'coordinator',
    });
    expect(addWriter.spawned).toHaveLength(1);
    const parser = addWriter.spawned[0]!;
    expect(parser.workspaceMode).toBe('share');
    expect(parser.workspacePath).toBeTruthy();
    expect(fs.existsSync(parser.workspacePath!)).toBe(true);
    // Verify forked history copied coordinator seed event
    expect(getSessionEvents(parser.threadId).map(e => e.type)).toEqual(['input_accepted']);

    // Spawn sharded `inherit` verifiers via `tasks`
    const addShards = await swarmManager.add({
      callerThreadId: 'coord_1',
      name: 'check',
      brief: 'Verify slice',
      workspace: 'inherit',
      tasks: ['unit tests', 'lint'],
    });
    expect(addShards.spawned.map(s => s.name)).toEqual(['check-1', 'check-2']);

    await swarmManager.waitForIdle(started.swarm.id);

    // Every spawned worker ran once with its static system prompt & incremental delta user prompt
    const parserTurns = capturedTurns.filter(t => t.threadId === parser.threadId);
    expect(parserTurns).toHaveLength(1);
    expect(parserTurns[0]!.approvalPolicy).toBe('trustWorkspace');
    expect(parserTurns[0]!.tools).toContain('swarm');
    expect(parserTurns[0]!.extraSystemPrompt).toContain('name="parser"');
    const firstUserText = JSON.stringify(parserTurns[0]!.messages.at(-1));
    expect(firstUserText).toContain('<swarm_board_delta');
    expect(firstUserText).toContain('Implement parser module');

    const check1Turns = capturedTurns.filter(t => t.threadId === addShards.spawned[0]!.threadId);
    expect(check1Turns[0]!.approvalPolicy).toBe('askRisky');
    expect(check1Turns[0]!.extraSystemPrompt).toContain('read-only/verifier mode');

    // Post mentioning ONLY @parser -> only @parser wakes, receives ONLY incremental delta, system prompt identical!
    const postRes = swarmManager.post({
      callerThreadId: 'coord_1',
      message: '@parser please add edge-case tests',
    });
    expect(postRes.woken).toEqual(['parser']);
    await swarmManager.waitForIdle(started.swarm.id);

    const parserTurnsAfter = capturedTurns.filter(t => t.threadId === parser.threadId);
    expect(parserTurnsAfter).toHaveLength(2);
    expect(parserTurnsAfter[1]!.extraSystemPrompt).toBe(parserTurnsAfter[0]!.extraSystemPrompt);
    const secondUserText = JSON.stringify(parserTurnsAfter[1]!.messages.at(-1));
    expect(secondUserText).toContain('edge-case tests');
    expect(secondUserText).not.toContain('Implement parser module');
    // Unmentioned @check-1 stayed parked at zero tokens!
    expect(capturedTurns.filter(t => t.threadId === addShards.spawned[0]!.threadId)).toHaveLength(1);

    // Permission checks: worker cannot set title or kill sibling worker
    expect(() =>
      swarmManager.title({ callerThreadId: parser.threadId, title: 'hijack' })
    ).toThrow(/Only @coordinator/);
    await expect(
      swarmManager.kill({ callerThreadId: parser.threadId, name: 'check-1' })
    ).rejects.toThrow(/only kill helpers it spawned/);

    // Worker spawns a helper and CAN kill its own helper
    const helperAdd = await swarmManager.add({
      callerThreadId: parser.threadId,
      name: 'sub-helper',
      brief: 'Assist parser',
      workspace: 'inherit',
    });
    await swarmManager.waitForIdle(started.swarm.id);
    const killHelper = await swarmManager.kill({
      callerThreadId: parser.threadId,
      name: helperAdd.spawned[0]!.name,
    });
    expect(killHelper.killed).toBe(true);

    // Hot model switch while waiting preserves history & updates next turn's model
    const switched = swarmManager.model({
      callerThreadId: 'coord_1',
      name: 'parser',
      model: 'model-b',
      reason: 'higher reasoning tier',
    });
    expect(switched.model).toBe('model-b');

    // Ping-pong guardrail trips at maxPingPongHops (2) and resets on human postAsUser
    const hop2 = swarmManager.post({
      callerThreadId: parser.threadId,
      message: '@check-1 ready for review',
    });
    expect(hop2.woken).toEqual(['check-1']);
    await swarmManager.waitForIdle(started.swarm.id);

    const hop3 = swarmManager.post({
      callerThreadId: addShards.spawned[0]!.threadId,
      message: '@parser needs fix',
    });
    expect(hop3.guardrailTriggered).toBe('maxPingPongHops');
    expect(hop3.woken).toEqual([]);

    // Human intervention resets ping-pong counter and wakes @parser with new model-b!
    const humanPost = swarmManager.postAsUser(started.swarm.id, '@parser proceed with model-b');
    expect(humanPost.woken).toEqual(['parser']);
    await swarmManager.waitForIdle(started.swarm.id);
    const latestParserTurn = capturedTurns.filter(t => t.threadId === parser.threadId).at(-1)!;
    expect(latestParserTurn.model).toBe('model-b');

    // Killing @parser cleans up its share worktree directory on disk
    await swarmManager.kill({ callerThreadId: 'coord_1', name: 'parser', deleteBranch: true });
    expect(fs.existsSync(parser.workspacePath!)).toBe(false);
    const finalStatus = swarmManager.status({ callerThreadId: 'coord_1' });
    expect(finalStatus.members.find(m => m.name === 'parser')?.status).toBe('killed');
  });
});
