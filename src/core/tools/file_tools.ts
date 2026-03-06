import { z } from 'zod';
import * as fs from 'fs/promises';
import * as path from 'path';
import { BaseTool } from './base';
import { tool, type Tool } from 'ai';

const workspaceRoot = path.resolve(process.cwd());

const resolvePathWithinWorkspace = (inputPath: string) => {
  const absolutePath = path.resolve(
    path.isAbsolute(inputPath) ? inputPath : path.join(workspaceRoot, inputPath)
  );
  const relativePath = path.relative(workspaceRoot, absolutePath);
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    throw new Error(`Path "${inputPath}" is outside workspace root: ${workspaceRoot}`);
  }
  return absolutePath;
};

/**
 * Tool for reading file content
 */
export const readFileTool: Tool = tool({
  description: 'Read the content of a file from the local filesystem',
  inputSchema: z.object({
    path: z.string().describe('The absolute path to the file to read'),
    encoding: z.string().optional().default('utf-8').describe('File encoding'),
  }),
  needsApproval: false,
  execute: async ({ path: filePath, encoding }) => {
    const absolutePath = resolvePathWithinWorkspace(filePath);

    const content = await fs.readFile(absolutePath, {
      encoding: encoding as BufferEncoding,
    });
    return { path: absolutePath, content };
  },
});

export class ReadFileTool extends BaseTool {
  name = 'read_file';
  type = 'function';
  needsApproval = true;
  description = 'Read the content of a file from the local filesystem.';

  paramSchema = z.object({
    path: z.string().describe('The absolute path to the file to read'),
    encoding: z.string().optional().default('utf-8').describe('File encoding'),
  });

  get parameters() {
    return {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'The absolute path to the file to read' },
        encoding: { type: 'string', description: 'File encoding', default: 'utf-8' },
      },
      required: ['path'],
    };
  }

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
  paramSchema = z.object({
    path: z.string().describe('The absolute path to the file to write'),
    content: z.string().describe('The content to write to the file'),
    encoding: z.string().optional().default('utf-8').describe('File encoding'),
  });

  get parameters() {
    return {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'The absolute path to the file to write' },
        content: { type: 'string', description: 'The content to write to the file' },
        encoding: { type: 'string', description: 'File encoding', default: 'utf-8' },
      },
      required: ['path', 'content'],
    };
  }

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
  needsApproval = true;
  paramSchema = z.object({
    path: z.string().describe('The absolute path to the directory to list'),
    recursive: z
      .boolean()
      .optional()
      .default(false)
      .describe('Whether to list subdirectories recursively'),
  });

  get parameters() {
    return {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'The absolute path to the directory to list' },
        recursive: {
          type: 'boolean',
          description: 'Whether to list subdirectories recursively',
          default: false,
        },
      },
      required: ['path'],
    };
  }

  protected async handler(args: z.infer<typeof this.paramSchema>) {
    const absolutePath = resolvePathWithinWorkspace(args.path);

    const entries = await fs.readdir(absolutePath, { withFileTypes: true });

    return entries.map(entry => ({
      name: entry.name,
      isDirectory: entry.isDirectory(),
      isFile: entry.isFile(),
      path: path.join(absolutePath, entry.name),
    }));
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

  paramSchema = z.object({
    path: z.string().describe('The absolute path to the file to delete'),
  });

  get parameters() {
    return {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'The absolute path to the file to delete' },
      },
      required: ['path'],
    };
  }

  protected async handler(args: z.infer<typeof this.paramSchema>) {
    const absolutePath = resolvePathWithinWorkspace(args.path);

    await fs.unlink(absolutePath);
    return { path: absolutePath, deleted: true };
  }
}
