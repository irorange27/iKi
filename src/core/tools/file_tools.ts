import { z } from 'zod';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { BaseTool } from './base';
import {
  DeleteFileInputSchema,
  EditFileInputSchema,
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

const countOccurrences = (content: string, search: string): number => {
  if (!search) return 0;
  let count = 0;
  let startIndex = 0;

  while (startIndex <= content.length) {
    const matchIndex = content.indexOf(search, startIndex);
    if (matchIndex === -1) break;
    count += 1;
    startIndex = matchIndex + search.length;
  }

  return count;
};

const replaceFirstOccurrence = (content: string, search: string, replacement: string): string => {
  const matchIndex = content.indexOf(search);
  if (matchIndex === -1) return content;
  return content.slice(0, matchIndex) + replacement + content.slice(matchIndex + search.length);
};

export class ReadFileTool extends BaseTool {
  override name = 'read_file';
  override type = 'function';
  override autoAllowed = true;
  override needsApproval = true;
  override description = 'Read the content of a file from the local filesystem.';

  override paramSchema = ReadFileInputSchema;

  protected override async handler(args: z.infer<typeof this.paramSchema>) {
    const absolutePath = await resolveReadableWorkspacePath(args.path);

    const content = await fs.readFile(absolutePath, { encoding: args.encoding as BufferEncoding });
    return { path: absolutePath, content };
  }
}

/**
 * Tool for writing file content
 */
export class WriteFileTool extends BaseTool {
  override name = 'write_file';
  override type = 'function';
  override autoAllowed = true;
  override description = 'Write or overwrite content to a file on the local filesystem.';
  override needsApproval = true;
  override paramSchema = WriteFileInputSchema;

  protected override async handler(args: z.infer<typeof this.paramSchema>) {
    const absolutePath = await resolveWritableWorkspacePath(args.path);

    // Ensure directory exists
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });

    await fs.writeFile(absolutePath, args.content, { encoding: args.encoding as BufferEncoding });
    return { path: absolutePath, success: true };
  }
}

/**
 * Tool for applying exact-text edits to an existing file
 */
export class EditFileTool extends BaseTool {
  override name = 'edit';
  override type = 'function';
  override autoAllowed = true;
  override description =
    'Edit an existing file by applying exact text replacements without rewriting the whole file.';
  override needsApproval = true;
  override paramSchema = EditFileInputSchema;

  protected override async handler(args: z.infer<typeof this.paramSchema>) {
    const absolutePath = await resolveWritableWorkspacePath(args.path);

    let originalContent: string;
    try {
      originalContent = await fs.readFile(absolutePath, {
        encoding: args.encoding as BufferEncoding,
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error(`File "${args.path}" does not exist. Use write_file to create it first.`);
      }
      throw error;
    }

    let updatedContent = originalContent;
    let totalReplacements = 0;

    for (const [index, edit] of args.edits.entries()) {
      const occurrences = countOccurrences(updatedContent, edit.oldText);

      if (occurrences === 0) {
        throw new Error(
          `Edit ${index + 1} could not find the target text in "${args.path}". Read the file again and retry with an exact match.`
        );
      }

      if (!edit.replaceAll && occurrences !== 1) {
        throw new Error(
          `Edit ${index + 1} matched ${occurrences} locations in "${args.path}". Provide a more specific oldText or set replaceAll to true.`
        );
      }

      updatedContent = edit.replaceAll
        ? updatedContent.split(edit.oldText).join(edit.newText)
        : replaceFirstOccurrence(updatedContent, edit.oldText, edit.newText);

      totalReplacements += edit.replaceAll ? occurrences : 1;
    }

    const changed = updatedContent !== originalContent;
    if (changed) {
      await fs.writeFile(absolutePath, updatedContent, {
        encoding: args.encoding as BufferEncoding,
      });
    }

    return {
      path: absolutePath,
      success: true,
      changed,
      appliedEditCount: args.edits.length,
      totalReplacements,
    };
  }
}

/**
 * Tool for listing directory contents
 */
export class ListDirTool extends BaseTool {
  override name = 'list_dir';
  override type = 'function';
  override autoAllowed = true;
  override description = 'List the contents of a directory on the local filesystem.';
  override needsApproval = false;
  override paramSchema = ListDirInputSchema;

  protected override async handler(args: z.infer<typeof this.paramSchema>) {
    const absolutePath = await resolveReadableWorkspacePath(args.path);
    return listDirEntries(absolutePath, Boolean(args.recursive));
  }
}

/**
 * Tool for deleting a file
 */
export class DeleteFileTool extends BaseTool {
  override name = 'delete_file';
  override type = 'function';
  override needsApproval = true;
  override description = 'Delete a file from the local filesystem. BE CAREFUL with this tool.';

  override paramSchema = DeleteFileInputSchema;

  protected override async handler(args: z.infer<typeof this.paramSchema>) {
    const absolutePath = await resolveDeleteWorkspacePath(args.path);

    await fs.unlink(absolutePath);
    return { path: absolutePath, deleted: true };
  }
}
