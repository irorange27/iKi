import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import {
  ensureThreadWorkspaceSelection,
  getThreadWorkspaceSelection,
  type ThreadWorkspaceSelection,
} from '../workspaces/thread_workspace';
import { getUserDataPath } from '../platform';
import { isPathWithinRoot } from '@iki/backend/utils/path_boundary';
import { getToolRuntimeContext } from '../utils/runtime_context';

/** What a workspace path resolves to.
 *
 *  `validated` is the path the boundary check actually examined — realpath
 *  resolved, every component verified inside the roots. It is the ONLY path
 *  safe to open: the caller-supplied path may contain a link that is swapped
 *  between the check and the use (audit H5).
 *
 *  `display` is the caller's own path, anchored on the workspace root as the
 *  caller wrote it. Tool results echo this so a model and a user see the path
 *  they used, not a host-specific resolved form (e.g. macOS /var vs
 *  /private/var). */
export type ResolvedWorkspacePath = {
  validated: string;
  display: string;
};

export type WorkspaceRoot = {
  resolvedPath: string;
  realPath: string;
};

const BRAIN_ALIAS_PREFIX = 'brain';
const getBrainRootPath = (): string => path.resolve(path.join(getUserDataPath(), BRAIN_ALIAS_PREFIX));

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
  // Read-only inside a run: the harness snapshots the selection at turn start
  // onto the runtime context, and every context copy shares that box. Never
  // write a box here — the SDK tool adapter spreads the context per
  // invocation, so a box stored on a copy would be discarded with it.
  const box = getToolRuntimeContext().workspaceSelectionBox;
  if (box) {
    return box.selection as ThreadWorkspaceSelection | null;
  }
  // Outside a harness run (direct tool routes) resolve from thread state.
  const { threadId } = getToolRuntimeContext();
  return ensureThreadWorkspaceSelection(threadId) ?? getThreadWorkspaceSelection(threadId);
};

const getWorkspaceSelectionRequirementError = (): Error =>
  new Error(
    'Filesystem and shell tools require an active conversation workspace. Choose one with the workspace picker at the top of the chat before using local tools.'
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

const resolveBrainRoot = async (): Promise<WorkspaceRoot> => {
  const resolvedPath = getBrainRootPath();
  await fs.mkdir(resolvedPath, { recursive: true });
  const realPath = await resolveRootRealPath(resolvedPath);
  return { resolvedPath, realPath };
};

export const resolveWorkspaceRoots = async (): Promise<WorkspaceRoot[]> => {
  const explicitRoots = await resolveExplicitWorkspaceRoots();
  const brainRoot = await resolveBrainRoot();
  const deduped = new Map<string, WorkspaceRoot>();

  for (const root of [...explicitRoots, brainRoot]) {
    deduped.set(root.realPath, root);
  }

  return [...deduped.values()];
};

const formatWorkspaceRoots = (roots: WorkspaceRoot[]): string =>
  roots.map(root => root.resolvedPath).join(', ');

const resolveAbsoluteWorkspacePath = (
  inputPath: string,
  primaryRoot: string,
  roots: WorkspaceRoot[]
): string => {
  if (path.isAbsolute(inputPath)) {
    return path.resolve(inputPath);
  }

  const normalizedInputPath = inputPath.trim().replace(/\\/g, '/');
  if (
    normalizedInputPath === BRAIN_ALIAS_PREFIX ||
    normalizedInputPath.startsWith(`${BRAIN_ALIAS_PREFIX}/`)
  ) {
    const brainRoot =
      roots.find(root => root.resolvedPath === getBrainRootPath())?.resolvedPath || getBrainRootPath();
    const relativePath =
      normalizedInputPath === BRAIN_ALIAS_PREFIX
        ? ''
        : normalizedInputPath.slice(BRAIN_ALIAS_PREFIX.length + 1);
    return path.resolve(path.join(brainRoot, relativePath));
  }

  return path.resolve(path.join(primaryRoot, inputPath));
};

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
    if (code === 'ENOENT') {
      const entry = await fs.lstat(targetPath).catch((statError: NodeJS.ErrnoException): null => {
        if (statError.code === 'ENOENT') return null;
        throw statError;
      });
      if (entry?.isSymbolicLink()) {
        throw new Error(`Path "${targetPath}" is a dangling symbolic link`);
      }
      return null;
    }
    throw error;
  }
};

const resolveExistingAncestorRealPath = async (targetPath: string): Promise<string> => {
  let currentPath = path.resolve(targetPath);

  while (currentPath) {
    const realPath = await tryRealpath(currentPath);
    if (realPath) return realPath;

    const parentPath = path.dirname(currentPath);
    currentPath = parentPath === currentPath ? '' : parentPath;
  }

  throw new Error(`Path "${targetPath}" does not have an existing ancestor`);
};

export const resolveReadableWorkspacePath = async (inputPath: string): Promise<ResolvedWorkspacePath> => {
  const roots = await resolveWorkspaceRoots();
  // Resolution and every boundary check run against the VALIDATED root
  // (realPath — isPathWithinRoot compares against it), so what we hand back
  // is on the same footing as the check (audit H5). The caller's own root
  // spelling is kept separately for the display path.
  const primaryRoot = roots[0]?.realPath;
  const displayRoot = roots[0]?.resolvedPath;
  if (!primaryRoot) {
    throw getWorkspaceSelectionRequirementError();
  }
  const absolutePath = resolveAbsoluteWorkspacePath(inputPath, primaryRoot, roots);
  const actualPath = await fs.realpath(absolutePath);
  ensurePathWithinWorkspaceRoots(inputPath, actualPath, roots);
  // `validated` is what the check examined. `display` keeps the caller's own
  // spelling so tool results show the path they used, not a host-resolved form.
  return { validated: actualPath, display: path.join(displayRoot ?? primaryRoot, path.relative(primaryRoot, absolutePath)) };
};

export const resolveWritableWorkspacePath = async (inputPath: string): Promise<ResolvedWorkspacePath> => {
  const roots = await resolveWorkspaceRoots();
  // Resolution and every boundary check run against the VALIDATED root
  // (realPath — isPathWithinRoot compares against it), so what we hand back
  // is on the same footing as the check (audit H5). The caller's own root
  // spelling is kept separately for the display path.
  const primaryRoot = roots[0]?.realPath;
  const displayRoot = roots[0]?.resolvedPath;
  if (!primaryRoot) {
    throw getWorkspaceSelectionRequirementError();
  }
  const absolutePath = resolveAbsoluteWorkspacePath(inputPath, primaryRoot, roots);

  // Same contract as the readable path.
  const existingTargetRealPath = await tryRealpath(absolutePath);
  if (existingTargetRealPath) {
    ensurePathWithinWorkspaceRoots(inputPath, existingTargetRealPath, roots);
    return { validated: existingTargetRealPath, display: path.join(displayRoot ?? primaryRoot, path.relative(primaryRoot, absolutePath)) };
  }

  const existingAncestorRealPath = await resolveExistingAncestorRealPath(absolutePath);
  ensurePathWithinWorkspaceRoots(inputPath, existingAncestorRealPath, roots);
  // A not-yet-existing target: the ancestor is validated, so the target is
  // that real directory joined with the segments that do not exist yet. Those
  // segments are the caller's own literal path components — none of them a
  // link that could have been swapped after the check.
  const validatedAncestor = path.resolve(existingAncestorRealPath);
  const missingTail = path.relative(validatedAncestor, path.resolve(absolutePath));
  return { validated: path.join(validatedAncestor, missingTail), display: path.join(displayRoot ?? primaryRoot, path.relative(primaryRoot, absolutePath)) };
};

export const resolveDeleteWorkspacePath = async (inputPath: string): Promise<ResolvedWorkspacePath> => {
  const roots = await resolveWorkspaceRoots();
  // Resolution and every boundary check run against the VALIDATED root
  // (realPath — isPathWithinRoot compares against it), so what we hand back
  // is on the same footing as the check (audit H5). The caller's own root
  // spelling is kept separately for the display path.
  const primaryRoot = roots[0]?.realPath;
  const displayRoot = roots[0]?.resolvedPath;
  if (!primaryRoot) {
    throw getWorkspaceSelectionRequirementError();
  }
  const absolutePath = resolveAbsoluteWorkspacePath(inputPath, primaryRoot, roots);
  const parentRealPath = await resolveExistingAncestorRealPath(path.dirname(absolutePath));
  ensurePathWithinWorkspaceRoots(inputPath, parentRealPath, roots);
  // The parent directory is what was validated; the path below it is the
  // caller's own literal, so the join cannot alias back outside.
  const validatedParent = path.resolve(parentRealPath);
  const parentTail = path.relative(validatedParent, path.resolve(absolutePath));
  return { validated: path.join(validatedParent, parentTail), display: path.join(displayRoot ?? primaryRoot, path.relative(primaryRoot, absolutePath)) };
};

export const resolveShellWorkingDirectory = async (inputCwd?: string): Promise<string> => {
  const roots = await resolveWorkspaceRoots();
  // Resolution and every boundary check run against the VALIDATED root
  // (realPath — isPathWithinRoot compares against it), so what we hand back
  // is on the same footing as the check (audit H5). The caller's own root
  // spelling is kept separately for the display path.
  const primaryRoot = roots[0]?.realPath;
  const displayRoot = roots[0]?.resolvedPath;
  if (!primaryRoot) {
    throw getWorkspaceSelectionRequirementError();
  }
  const cwd = inputCwd?.trim()
    ? resolveAbsoluteWorkspacePath(inputCwd.trim(), primaryRoot, roots)
    : primaryRoot;
  const actualPath = await fs.realpath(cwd);
  ensurePathWithinWorkspaceRoots(inputCwd?.trim() || cwd, actualPath, roots);
  return cwd;
};
