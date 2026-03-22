import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import {
  getThreadWorkspaceSelection,
  type ThreadWorkspaceSelection,
} from '../workspaces/thread_workspace';
import { getToolRuntimeContext } from './runtime_context';

export type WorkspaceRoot = {
  resolvedPath: string;
  realPath: string;
};

const resolveRootRealPath = async (root: string): Promise<string> => {
  try {
    return await fs.realpath(root);
  } catch {
    return root;
  }
};

const normalizeWorkspacePath = (rawPath: unknown): string => {
  if (typeof rawPath !== 'string') return '';
  return rawPath.trim();
};

const resolveThreadWorkspaceSelection = (): ThreadWorkspaceSelection | null => {
  const { threadId } = getToolRuntimeContext();
  return getThreadWorkspaceSelection(threadId);
};

const getWorkspaceSelectionRequirementError = (): Error =>
  new Error(
    'Filesystem and shell tools require an active conversation workspace. Choose a workspace in the composer before using local tools.'
  );

const resolveExplicitWorkspaceRoots = async (): Promise<WorkspaceRoot[]> => {
  const selection = resolveThreadWorkspaceSelection();
  if (!selection?.threadId) {
    throw getWorkspaceSelectionRequirementError();
  }
  if (!selection.workspaceId) {
    throw getWorkspaceSelectionRequirementError();
  }

  if (!selection.workspace) {
    throw new Error(
      `Selected workspace "${selection.workspaceId}" is unavailable. Choose another workspace in the composer before using filesystem or shell tools.`
    );
  }

  const workspacePath = normalizeWorkspacePath(selection.workspace.path);
  if (!workspacePath) {
    throw new Error(
      `Selected workspace "${selection.workspaceId}" does not have a valid root path. Choose another workspace in the composer before using filesystem or shell tools.`
    );
  }

  const resolvedPath = path.resolve(workspacePath);
  const realPath = await resolveRootRealPath(resolvedPath);
  return [{ resolvedPath, realPath }];
};

export const resolveWorkspaceRoots = async (): Promise<WorkspaceRoot[]> => {
  return await resolveExplicitWorkspaceRoots();
};

const isPathWithinRoot = (root: string, candidate: string): boolean => {
  const relativePath = path.relative(root, candidate);
  return !(relativePath.startsWith('..') || path.isAbsolute(relativePath));
};

const formatWorkspaceRoots = (roots: WorkspaceRoot[]): string =>
  roots.map(root => root.resolvedPath).join(', ');

const resolveAbsoluteWorkspacePath = (inputPath: string, primaryRoot: string): string =>
  path.resolve(path.isAbsolute(inputPath) ? inputPath : path.join(primaryRoot, inputPath));

const ensurePathWithinWorkspaceRoots = (
  inputPath: string,
  actualPath: string,
  roots: WorkspaceRoot[]
) => {
  if (!roots.some(root => isPathWithinRoot(root.realPath, actualPath))) {
    throw new Error(
      `Path "${inputPath}" is outside workspace roots: ${formatWorkspaceRoots(roots)}`
    );
  }
};

const tryRealpath = async (targetPath: string): Promise<string | null> => {
  try {
    return await fs.realpath(targetPath);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return null;
    throw error;
  }
};

const resolveExistingAncestorRealPath = async (targetPath: string): Promise<string> => {
  let currentPath = path.resolve(targetPath);
  let parentPath = '';

  while (currentPath !== parentPath) {
    const realPath = await tryRealpath(currentPath);
    if (realPath) return realPath;

    parentPath = path.dirname(currentPath);
    currentPath = parentPath;
  }

  throw new Error(`Path "${targetPath}" does not have an existing ancestor`);
};

export const resolveReadableWorkspacePath = async (inputPath: string): Promise<string> => {
  const roots = await resolveWorkspaceRoots();
  const primaryRoot = roots[0]?.resolvedPath;
  if (!primaryRoot) {
    throw getWorkspaceSelectionRequirementError();
  }
  const absolutePath = resolveAbsoluteWorkspacePath(inputPath, primaryRoot);
  const actualPath = await fs.realpath(absolutePath);
  ensurePathWithinWorkspaceRoots(inputPath, actualPath, roots);
  return absolutePath;
};

export const resolveWritableWorkspacePath = async (inputPath: string): Promise<string> => {
  const roots = await resolveWorkspaceRoots();
  const primaryRoot = roots[0]?.resolvedPath;
  if (!primaryRoot) {
    throw getWorkspaceSelectionRequirementError();
  }
  const absolutePath = resolveAbsoluteWorkspacePath(inputPath, primaryRoot);

  const existingTargetRealPath = await tryRealpath(absolutePath);
  if (existingTargetRealPath) {
    ensurePathWithinWorkspaceRoots(inputPath, existingTargetRealPath, roots);
    return absolutePath;
  }

  const existingAncestorRealPath = await resolveExistingAncestorRealPath(
    path.dirname(absolutePath)
  );
  ensurePathWithinWorkspaceRoots(inputPath, existingAncestorRealPath, roots);
  return absolutePath;
};

export const resolveDeleteWorkspacePath = async (inputPath: string): Promise<string> => {
  const roots = await resolveWorkspaceRoots();
  const primaryRoot = roots[0]?.resolvedPath;
  if (!primaryRoot) {
    throw getWorkspaceSelectionRequirementError();
  }
  const absolutePath = resolveAbsoluteWorkspacePath(inputPath, primaryRoot);
  const parentRealPath = await resolveExistingAncestorRealPath(path.dirname(absolutePath));
  ensurePathWithinWorkspaceRoots(inputPath, parentRealPath, roots);
  return absolutePath;
};

export const resolveShellWorkingDirectory = async (inputCwd?: string): Promise<string> => {
  const roots = await resolveWorkspaceRoots();
  const primaryRoot = roots[0]?.resolvedPath;
  if (!primaryRoot) {
    throw getWorkspaceSelectionRequirementError();
  }
  const cwd = inputCwd?.trim()
    ? resolveAbsoluteWorkspacePath(inputCwd.trim(), primaryRoot)
    : primaryRoot;
  const actualPath = await fs.realpath(cwd);
  ensurePathWithinWorkspaceRoots(inputCwd?.trim() || cwd, actualPath, roots);
  return cwd;
};
