import { z } from 'zod';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { BaseTool } from './base';
import {
  DeleteFileInputSchema,
  ListDirInputSchema,
  ReadFileInputSchema,
  WriteFileInputSchema,
} from './schemas';
import {
  resolveDeleteWorkspacePath,
  resolveReadableWorkspacePath,
  resolveWritableWorkspacePath,
} from './workspace_paths';

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
  autoAllowed = true;
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
  autoAllowed = true;
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
  autoAllowed = true;
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
