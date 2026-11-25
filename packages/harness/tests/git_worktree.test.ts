import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { setPlatformInfo } from '@iki/core/platform';
import { wirePlatformContext } from '@iki/core/platform_wiring';
import { initializeDatabase } from '@iki/store/database';
import * as workspaceDb from '@iki/store/workspaces';
import {
  cleanupIsolatedWorkspace,
  inspectGitWorkspace,
  provisionIsolatedWorkspace,
} from '../src/workspaces/git_worktree';
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
  fs.writeFileSync(path.join(dir, 'README.md'), '# hello\n', 'utf8');
  execFileSync('git', ['add', 'README.md'], { cwd: dir, stdio: 'ignore' });
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

describe('git_worktree isolation driver', () => {
  it('provisions and cleans up inherit, share (worktree), and branch (clone) workspaces', () => {
    const dataDir = makeTempDir('iki-wt-data-');
    const repoDir = makeTempDir('iki-wt-repo-');
    wirePlatformContext();
    setPlatformInfo({ userDataPath: dataDir });
    initializeDatabase();
    initGitRepo(repoDir);

    const cleanInspection = inspectGitWorkspace(repoDir);
    expect(cleanInspection.isGitRepo).toBe(true);
    expect(cleanInspection.dirty).toBe(false);
    expect(cleanInspection.branch).toBe('main');

    // Create an uncommitted file to verify dirty warning propagation
    fs.writeFileSync(path.join(repoDir, 'dirty.txt'), 'uncommitted\n', 'utf8');
    const dirtyInspection = inspectGitWorkspace(repoDir);
    expect(dirtyInspection.dirty).toBe(true);
    expect(dirtyInspection.dirtyFilesCount).toBe(1);

    const parentSelection: ThreadWorkspaceSelection = {
      threadId: 'coord',
      workspaceId: 'ws_parent',
      workspace: {
        id: 'ws_parent',
        name: 'repo',
        path: repoDir,
        is_temporary: false,
        show_in_list: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    };

    // 1. inherit mode reuses parent workspace verbatim
    const inherited = provisionIsolatedWorkspace({
      mode: 'inherit',
      threadId: 'w_inherit',
      ownerId: 'swarm_1',
      label: 'verifier',
      parentSelection,
    });
    expect(inherited.workspacePath).toBe(repoDir);
    expect(inherited.branch).toBe('main');

    // 2. share mode creates an isolated git worktree sharing .git object store
    const shared = provisionIsolatedWorkspace({
      mode: 'share',
      threadId: 'w_share',
      ownerId: 'swarm_1',
      label: 'parser',
      parentSelection,
      baseDir: path.join(dataDir, 'swarm-worktrees'),
    });
    expect(shared.workspacePath).toBeTruthy();
    expect(shared.workspacePath).not.toBe(repoDir);
    expect(fs.existsSync(path.join(shared.workspacePath!, 'README.md'))).toBe(true);
    expect(fs.existsSync(path.join(shared.workspacePath!, 'dirty.txt'))).toBe(false);
    expect(shared.dirtyWarning).toMatch(/uncommitted change/);
    expect(shared.branch).toMatch(/^iki\/swarm\/swarm_1\/parser/);
    expect(workspaceDb.getWorkspace(shared.workspaceId!)).not.toBeNull();

    // Edits in share worktree do not touch parent working copy
    fs.writeFileSync(path.join(shared.workspacePath!, 'worker_only.txt'), 'isolated\n', 'utf8');
    expect(fs.existsSync(path.join(repoDir, 'worker_only.txt'))).toBe(false);

    cleanupIsolatedWorkspace({
      mode: 'share',
      repoRoot: shared.repoRoot,
      workspacePath: shared.workspacePath,
      workspaceId: shared.workspaceId,
      branch: shared.branch,
      deleteBranch: true,
    });
    expect(fs.existsSync(shared.workspacePath!)).toBe(false);
    expect(workspaceDb.getWorkspace(shared.workspaceId!)).toBeNull();

    // 3. branch mode creates an independent git clone
    const cloned = provisionIsolatedWorkspace({
      mode: 'branch',
      threadId: 'w_branch',
      ownerId: 'swarm_1',
      label: 'refactor',
      parentSelection,
      baseDir: path.join(dataDir, 'swarm-worktrees'),
    });
    expect(cloned.workspacePath).toBeTruthy();
    expect(fs.statSync(path.join(cloned.workspacePath!, '.git')).isDirectory()).toBe(true);

    cleanupIsolatedWorkspace({
      mode: 'branch',
      repoRoot: cloned.repoRoot,
      workspacePath: cloned.workspacePath,
      workspaceId: cloned.workspaceId,
    });
    expect(fs.existsSync(cloned.workspacePath!)).toBe(false);
  });
});
