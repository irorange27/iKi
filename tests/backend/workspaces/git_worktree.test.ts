// @vitest-environment node

import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const execFileAsync = promisify(execFile);

const { getUserDataPathMock } = vi.hoisted(() => ({
  getUserDataPathMock: vi.fn(() => ''),
}));

vi.mock('../../../packages/backend/src/platform', () => ({
  getUserDataPath: getUserDataPathMock,
}));

const chatDb = await import('../../../packages/backend/src/db/chat_thread');
const workspaceDb = await import('../../../packages/backend/src/db/workspaces');
const database = await import('../../../packages/backend/src/db/database');

const gitWorktree = await import('../../../packages/backend/src/workspaces/git_worktree');

let dataDir = '';
let repoDir = '';

const runInRepo = async (args: string, cwd: string = repoDir) => {
  await execFileAsync('git', args.split(' '), { cwd });
};

const createThread = (threadId: string) => {
  chatDb.addChatThread({
    id: threadId,
    title: `Thread ${threadId}`,
    metadata: '{}',
  });
};

describe('git_worktree', () => {
  beforeAll(async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), 'iki-wt-'));
    getUserDataPathMock.mockReturnValue(dataDir);
    database.initializeDatabase({ dbPath: path.join(dataDir, 'test.db') });

    repoDir = path.join(dataDir, 'repo');
    fs.mkdirSync(repoDir, { recursive: true });
    await runInRepo('init');
    await runInRepo('config user.email test@example.com');
    await runInRepo('config user.name test');
    fs.writeFileSync(path.join(repoDir, 'README.md'), 'hello');
    await runInRepo('add .');
    await runInRepo('commit -m init');

    workspaceDb.addWorkspace({
      id: 'ws_repo',
      path: repoDir,
      name: 'repo',
      is_temporary: 0,
      show_in_list: 1,
    });
    createThread('thread_wt_1');
    chatDb.updateChatThread('thread_wt_1', { workspace_id: 'ws_repo' });
  });

  afterAll(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  it('detects git repositories', async () => {
    expect(await gitWorktree.isGitRepository(repoDir)).toBe(true);
    expect(await gitWorktree.isGitRepository(dataDir)).toBe(false);
  });

  it('creates a worktree, registers it, and assigns the thread', async () => {
    const result = await gitWorktree.createThreadWorktree('thread_wt_1', 'ws_repo');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.created).toBe(true);
    expect(result.branch).toBe('iki/thread_wt_1');
    expect(result.workspace.id).toBe('workspace_wt_thread_wt_1');
    expect(result.workspace.path.startsWith(dataDir)).toBe(true);
    expect(fs.existsSync(result.workspace.path)).toBe(true);
    expect(chatDb.getChatThread('thread_wt_1')?.workspace_id).toBe(
      'workspace_wt_thread_wt_1'
    );

    // README from the repo HEAD is present in the worktree checkout.
    expect(fs.existsSync(path.join(result.workspace.path, 'README.md'))).toBe(true);

    // Idempotent reuse.
    const again = await gitWorktree.createThreadWorktree('thread_wt_1', 'ws_repo');
    expect(again.ok).toBe(true);
    if (again.ok) expect(again.created).toBe(false);
  });

  it('rejects worktree creation for non-git workspaces', async () => {
    const plainDir = path.join(dataDir, 'plain');
    fs.mkdirSync(plainDir, { recursive: true });
    workspaceDb.addWorkspace({
      id: 'ws_plain',
      path: plainDir,
      name: 'plain',
      is_temporary: 0,
      show_in_list: 1,
    });
    createThread('thread_plain');
    chatDb.updateChatThread('thread_plain', { workspace_id: 'ws_plain' });

    const result = await gitWorktree.createThreadWorktree('thread_plain', 'ws_plain');
    expect(result.ok).toBe(false);
  });

  it('refuses to remove a dirty worktree without force, removes it with force', async () => {
    const worktreePath = path.join(
      dataDir,
      'thread-worktrees',
      'thread_wt_1'
    );
    fs.writeFileSync(path.join(worktreePath, 'dirty.txt'), 'uncommitted');

    const refused = await gitWorktree.removeThreadWorktree('thread_wt_1');
    expect(refused.ok).toBe(false);
    expect(fs.existsSync(worktreePath)).toBe(true);

    const removed = await gitWorktree.removeThreadWorktree('thread_wt_1', { force: true });
    expect(removed.ok).toBe(true);
    expect(fs.existsSync(worktreePath)).toBe(false);
    expect(workspaceDb.getWorkspace('workspace_wt_thread_wt_1')).toBeNull();
  });

  it('merges the worktree branch back into the main checkout', async () => {
    // Fresh thread + worktree; agent commits a change on the branch.
    createThread('thread_merge');
    chatDb.updateChatThread('thread_merge', { workspace_id: 'ws_repo' });
    const created = await gitWorktree.createThreadWorktree('thread_merge', 'ws_repo');
    expect(created.ok).toBe(true);

    const worktreePath = path.join(dataDir, 'thread-worktrees', 'thread_merge');
    fs.writeFileSync(path.join(worktreePath, 'feature.txt'), 'agent work');
    await execFileAsync('git', ['add', '.'], { cwd: worktreePath });
    await execFileAsync('git', ['-c', 'user.email=a@b', '-c', 'user.name=a', 'commit', '-m', 'agent change'], { cwd: worktreePath });

    const result = await gitWorktree.mergeThreadWorktree('thread_merge');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.branch).toBe('iki/thread_merge');

    // The main checkout now contains the agent's file.
    expect(fs.existsSync(path.join(repoDir, 'feature.txt'))).toBe(true);
  });

  it('refuses to merge when the main checkout is dirty', async () => {
    createThread('thread_merge_dirty');
    chatDb.updateChatThread('thread_merge_dirty', { workspace_id: 'ws_repo' });
    await gitWorktree.createThreadWorktree('thread_merge_dirty', 'ws_repo');
    const worktreePath = path.join(dataDir, 'thread-worktrees', 'thread_merge_dirty');
    fs.writeFileSync(path.join(worktreePath, 'w.txt'), 'w');
    await execFileAsync('git', ['add', '.'], { cwd: worktreePath });
    await execFileAsync('git', ['-c', 'user.email=a@b', '-c', 'user.name=a', 'commit', '-m', 'w'], { cwd: worktreePath });

    // Dirty the main checkout.
    fs.writeFileSync(path.join(repoDir, 'user-note.txt'), 'user work in progress');

    const result = await gitWorktree.mergeThreadWorktree('thread_merge_dirty');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('uncommitted changes');
    // The agent's work did NOT land in the main checkout.
    expect(fs.existsSync(path.join(repoDir, 'w.txt'))).toBe(false);
    fs.rmSync(path.join(repoDir, 'user-note.txt'));
  });
});
