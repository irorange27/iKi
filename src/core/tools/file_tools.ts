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

const resolveWorkspaceRoots = (): string[] => {
  const roots: string[] = [];
  const workspaces = getVisibleWorkspaces();
  for (const workspace of workspaces) {
    const rawPath = typeof workspace.path === 'string' ? workspace.path.trim() : '';
    if (!rawPath) continue;
    roots.push(path.resolve(rawPath));
  }

  const cwdRoot = path.resolve(process.cwd());
  if (!roots.includes(cwdRoot)) {
    roots.push(cwdRoot);
  }

  return roots.length > 0 ? roots : [cwdRoot];
};

const isPathWithinRoot = (root: string, candidate: string): boolean => {
  const relativePath = path.relative(root, candidate);
  return !(relativePath.startsWith('..') || path.isAbsolute(relativePath));
};

const resolvePathWithinWorkspace = (inputPath: string) => {
  const roots = resolveWorkspaceRoots();
  const primaryRoot = roots[0];
  const absolutePath = path.resolve(
    path.isAbsolute(inputPath) ? inputPath : path.join(primaryRoot, inputPath)
  );

  if (!roots.some(root => isPathWithinRoot(root, absolutePath))) {
    throw new Error(
      `Path "${inputPath}" is outside workspace roots: ${roots.join(', ')}`
    );
  }

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
    const absolutePath = resolvePathWithinWorkspace(args.path);

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
    const absolutePath = resolvePathWithinWorkspace(args.path);

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
    const absolutePath = resolvePathWithinWorkspace(args.path);
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
    const absolutePath = resolvePathWithinWorkspace(args.path);

    await fs.unlink(absolutePath);
    return { path: absolutePath, deleted: true };
  }
}
