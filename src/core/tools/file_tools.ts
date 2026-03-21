import { z } from 'zod';
import * as fs from 'fs/promises';
import * as path from 'path';
import { BaseTool } from './base';
import { getVisibleWorkspaces } from '../db/workspaces';
import {
  DeleteFileInputSchema,
  ListDirInputSchema,
  ReadFileInputSchema,
  WriteFileInputSchema,
} from './schemas';

type WorkspaceRoot = {
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

const resolveWorkspaceRoots = async (): Promise<WorkspaceRoot[]> => {
  const candidateRoots: string[] = [];
  const workspaces = getVisibleWorkspaces();
  for (const workspace of workspaces) {
    const rawPath = typeof workspace.path === 'string' ? workspace.path.trim() : '';
    if (!rawPath) continue;
    candidateRoots.push(path.resolve(rawPath));
  }

  const cwdRoot = path.resolve(process.cwd());
  if (!candidateRoots.includes(cwdRoot)) {
    candidateRoots.push(cwdRoot);
  }

  const roots: WorkspaceRoot[] = [];
  const seen = new Set<string>();

  for (const candidateRoot of candidateRoots.length > 0 ? candidateRoots : [cwdRoot]) {
    const realPath = await resolveRootRealPath(candidateRoot);
    const key = `${candidateRoot}\0${realPath}`;
    if (seen.has(key)) continue;
    seen.add(key);
    roots.push({ resolvedPath: candidateRoot, realPath });
  }

  return roots;
};

const isPathWithinRoot = (root: string, candidate: string): boolean => {
  const relativePath = path.relative(root, candidate);
  return !(relativePath.startsWith('..') || path.isAbsolute(relativePath));
};

const formatWorkspaceRoots = (roots: WorkspaceRoot[]): string =>
  roots.map(root => root.resolvedPath).join(', ');

const resolveAbsoluteWorkspacePath = (inputPath: string, primaryRoot: string): string =>
  path.resolve(
    path.isAbsolute(inputPath) ? inputPath : path.join(primaryRoot, inputPath)
  );

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

const resolveReadableWorkspacePath = async (inputPath: string): Promise<string> => {
  const roots = await resolveWorkspaceRoots();
  const primaryRoot = roots[0]?.resolvedPath ?? path.resolve(process.cwd());
  const absolutePath = resolveAbsoluteWorkspacePath(inputPath, primaryRoot);
  const actualPath = await fs.realpath(absolutePath);
  ensurePathWithinWorkspaceRoots(inputPath, actualPath, roots);
  return absolutePath;
};

const resolveWritableWorkspacePath = async (inputPath: string): Promise<string> => {
  const roots = await resolveWorkspaceRoots();
  const primaryRoot = roots[0]?.resolvedPath ?? path.resolve(process.cwd());
  const absolutePath = resolveAbsoluteWorkspacePath(inputPath, primaryRoot);

  const existingTargetRealPath = await tryRealpath(absolutePath);
  if (existingTargetRealPath) {
    ensurePathWithinWorkspaceRoots(inputPath, existingTargetRealPath, roots);
    return absolutePath;
  }

  const existingAncestorRealPath = await resolveExistingAncestorRealPath(path.dirname(absolutePath));
  ensurePathWithinWorkspaceRoots(inputPath, existingAncestorRealPath, roots);
  return absolutePath;
};

const resolveDeleteWorkspacePath = async (inputPath: string): Promise<string> => {
  const roots = await resolveWorkspaceRoots();
  const primaryRoot = roots[0]?.resolvedPath ?? path.resolve(process.cwd());
  const absolutePath = resolveAbsoluteWorkspacePath(inputPath, primaryRoot);
  const parentRealPath = await resolveExistingAncestorRealPath(path.dirname(absolutePath));
  ensurePathWithinWorkspaceRoots(inputPath, parentRealPath, roots);
  return absolutePath;
};

const listDirEntries = async (
  dir: string,
  recursive: boolean
): Promise<
  Array<{
    name: string;
    isDirectory: boolean;
    isFile: boolean;
    path: string;
  }>
> => {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const results: Array<{
    name: string;
    isDirectory: boolean;
    isFile: boolean;
    path: string;
  }> = [];

  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);
    const record = {
      name: entry.name,
      isDirectory: entry.isDirectory(),
      isFile: entry.isFile(),
      path: entryPath,
    };
    results.push(record);

    if (recursive && entry.isDirectory()) {
      results.push(...(await listDirEntries(entryPath, true)));
    }
  }

  return results;
};

export class ReadFileTool extends BaseTool {
  name = 'read_file';
  type = 'function';
  needsApproval = true;
  description = 'Read the content of a file from the local filesystem.';

  paramSchema = ReadFileInputSchema;

  protected async handler(args: z.infer<typeof this.paramSchema>) {
    const absolutePath = await resolveReadableWorkspacePath(args.path);

    const content = await fs.readFile(absolutePath, { encoding: args.encoding as BufferEncoding });
    return { path: absolutePath, content };
  }
}

/**
 * Tool for writing file content
 */
export class WriteFileTool extends BaseTool {
  name = 'write_file';
  type = 'function';
  description = 'Write or overwrite content to a file on the local filesystem.';
  needsApproval = true;
  paramSchema = WriteFileInputSchema;

  protected async handler(args: z.infer<typeof this.paramSchema>) {
    const absolutePath = await resolveWritableWorkspacePath(args.path);

    // Ensure directory exists
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });

    await fs.writeFile(absolutePath, args.content, { encoding: args.encoding as BufferEncoding });
    return { path: absolutePath, success: true };
  }
}

/**
 * Tool for listing directory contents
 */
export class ListDirTool extends BaseTool {
  name = 'list_dir';
  type = 'function';
  description = 'List the contents of a directory on the local filesystem.';
  needsApproval = false;
  paramSchema = ListDirInputSchema;

  protected async handler(args: z.infer<typeof this.paramSchema>) {
    const absolutePath = await resolveReadableWorkspacePath(args.path);
    return listDirEntries(absolutePath, Boolean(args.recursive));
  }
}

/**
 * Tool for deleting a file
 */
export class DeleteFileTool extends BaseTool {
  name = 'delete_file';
  type = 'function';
  needsApproval = true;
  description = 'Delete a file from the local filesystem. BE CAREFUL with this tool.';

  paramSchema = DeleteFileInputSchema;

  protected async handler(args: z.infer<typeof this.paramSchema>) {
    const absolutePath = await resolveDeleteWorkspacePath(args.path);

    await fs.unlink(absolutePath);
    return { path: absolutePath, deleted: true };
  }
}
