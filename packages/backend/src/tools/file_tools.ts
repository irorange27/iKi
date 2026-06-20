import { z } from 'zod';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { BaseTool } from '@iki/core/tools/base';
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

const FILE_CACHE_TTL_MS = 30_000;
const readFileCache = new Map<string, { createdAt: number; value: unknown }>();
const listDirCache = new Map<string, { createdAt: number; value: unknown }>();

const getCached = (cache: Map<string, { createdAt: number; value: unknown }>, key: string): unknown | undefined => {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (Date.now() - entry.createdAt > FILE_CACHE_TTL_MS) {
    cache.delete(key);
    return undefined;
  }
  return entry.value;
};

const setCached = (cache: Map<string, { createdAt: number; value: unknown }>, key: string, value: unknown): unknown => {
  cache.set(key, { createdAt: Date.now(), value });
  return value;
};

const clearFileReadCaches = () => {
  readFileCache.clear();
  listDirCache.clear();
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

const normalizeLine = (line: string): string => line.replace(/[\t ]+$/, '').replace(/^[\t ]+/, '');

const fuzzyLineMatch = (contentLines: string[], searchLines: string[], startFrom: number): number => {
  const maxStart = contentLines.length - searchLines.length;
  for (let i = startFrom; i <= maxStart; i++) {
    let allMatch = true;
    for (let j = 0; j < searchLines.length; j++) {
      if (normalizeLine(contentLines[i + j]) !== normalizeLine(searchLines[j])) {
        allMatch = false;
        break;
      }
    }
    if (allMatch) return i;
  }
  return -1;
};

const findInContent = (
  content: string,
  oldText: string,
  contextBefore?: string,
  contextAfter?: string
): { index: number; matchType: 'exact' | 'fuzzy' | 'context'; matchedText: string } | { index: -1; error: { message: string; fileSnippet: string; retryHint: string } } => {
  // Step 1: exact match
  const exactPos = content.indexOf(oldText);
  if (exactPos >= 0) {
    const count = countOccurrences(content, oldText);
    if (count === 1) {
      return { index: exactPos, matchType: 'exact', matchedText: oldText };
    }

    // Multiple exact matches — try context anchors to disambiguate
    if (contextBefore || contextAfter) {
      // Walk through each exact occurrence and test context anchors
      let searchFrom = 0;
      while (searchFrom <= content.length) {
        const candidatePos = content.indexOf(oldText, searchFrom);
        if (candidatePos === -1) break;

        const beforeOk = !contextBefore
          ? true
          : (() => {
              const beforeStart = Math.max(0, candidatePos - contextBefore.length - 50);
              const beforeRegion = content.substring(beforeStart, candidatePos);
              return beforeRegion.includes(contextBefore);
            })();

        const afterOk = !contextAfter
          ? true
          : (() => {
              const afterStart = candidatePos + oldText.length;
              const afterRegion = content.substring(afterStart, afterStart + contextAfter.length + 50);
              return afterRegion.includes(contextAfter);
            })();

        if (beforeOk && afterOk) {
          return { index: candidatePos, matchType: 'context', matchedText: oldText };
        }

        searchFrom = candidatePos + oldText.length;
      }

      // Context anchors were provided but no occurrence satisfied them
      const missingAnchors = [contextBefore && 'contextBefore', contextAfter && 'contextAfter']
        .filter(Boolean)
        .join(' and ');
      const oldFirstLine = oldText.split('\n')[0].substring(0, 80);
      return {
        index: -1,
        error: {
          message: `Could not find a match for "${oldFirstLine}..." with the provided ${missingAnchors} anchors.`,
          fileSnippet: content.substring(0, 600),
          retryHint: 'Re-read the file and verify the contextBefore/contextAfter text matches exactly. Each anchor must appear within 50 characters of the target text.',
        },
      };
    }

    // Return first exact match; handler decides based on replaceAll / occurrences
    return { index: exactPos, matchType: 'exact', matchedText: oldText };
  }

  // Step 2: fuzzy match over whole file (only when no exact match exists)
  const contentLines = content.split('\n');
  const searchLines = oldText.split('\n');
  const fuzzyPos = fuzzyLineMatch(contentLines, searchLines, 0);
  if (fuzzyPos >= 0) {
    // Extract the actual matched text with original whitespace so replacement is reliable
    const matchedText = contentLines.slice(fuzzyPos, fuzzyPos + searchLines.length).join('\n');
    const charPos = content.indexOf(matchedText);
    return { index: Math.max(0, charPos), matchType: 'fuzzy', matchedText };
  }

  // Step 3: failure — return structured error
  const oldFirstLine = oldText.split('\n')[0].substring(0, 80);
  const snippetStart = Math.max(0, exactPos > 0 ? exactPos - 200 : 0);
  const snippetEnd = Math.min(content.length, snippetStart + 600);

  return {
    index: -1,
    error: {
      message: `Could not find "${oldFirstLine}..." in the file.`,
      fileSnippet: content.substring(snippetStart, snippetEnd),
      retryHint: 'Re-read the file and copy the exact text to replace, including 1-3 lines of surrounding context as contextBefore/contextAfter anchors.',
    },
  };
};

const generateUnifiedDiff = (
  fileName: string,
  original: string,
  updated: string
): string => {
  const origLines = original.split('\n');
  const newLines = updated.split('\n');
  const parts: string[] = [];

  parts.push(`--- a/${fileName}`);
  parts.push(`+++ b/${fileName}`);

  // Find first and last changed blocks
  let firstChange = -1;
  let lastChange = -1;
  const maxLen = Math.max(origLines.length, newLines.length);
  for (let i = 0; i < maxLen; i++) {
    const origLine = i < origLines.length ? origLines[i] : undefined;
    const newLine = i < newLines.length ? newLines[i] : undefined;
    if (origLine !== newLine) {
      if (firstChange < 0) firstChange = i;
      lastChange = i;
    }
  }

  if (firstChange < 0) return '';

  // Include 2 lines of context
  const ctxStart = Math.max(0, firstChange - 2);
  const ctxEnd = Math.min(maxLen, lastChange + 3);
  const origChunkLen = Math.min(origLines.length, ctxEnd) - ctxStart;
  const newChunkLen = Math.min(newLines.length, ctxEnd) - ctxStart;

  parts.push(`@@ -${ctxStart + 1},${Math.max(origChunkLen, 0)} +${ctxStart + 1},${Math.max(newChunkLen, 0)} @@`);

  for (let i = ctxStart; i < ctxEnd; i++) {
    const origLine = i < origLines.length ? origLines[i] : undefined;
    const newLine = i < newLines.length ? newLines[i] : undefined;

    if (origLine === newLine) {
      if (origLine !== undefined) parts.push(` ${origLine}`);
    } else {
      if (origLine !== undefined) parts.push(`-${origLine}`);
      if (newLine !== undefined) parts.push(`+${newLine}`);
    }
  }

  return parts.join('\n');
};

export class ReadFileTool extends BaseTool {
  override name = 'read_file';
  override type = 'function';
  override autoAllowed = true;
  override needsApproval = false;
  override description = 'Read the content of a file from the local filesystem.';

  override paramSchema = ReadFileInputSchema;

  protected override async handler(args: z.infer<typeof this.paramSchema>) {
    const absolutePath = await resolveReadableWorkspacePath(args.path);
    const cacheKey = JSON.stringify([absolutePath, args.encoding]);
    const cached = getCached(readFileCache, cacheKey);
    if (cached !== undefined) return cached;

    const content = await fs.readFile(absolutePath, { encoding: args.encoding as BufferEncoding });
    return setCached(readFileCache, cacheKey, { path: absolutePath, content });
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
    clearFileReadCaches();
    return { path: absolutePath, success: true };
  }
}

/**
 * Tool for applying text edits to an existing file with fuzzy matching and diff output
 */
export class EditFileTool extends BaseTool {
  override name = 'edit';
  override type = 'function';
  override autoAllowed = true;
  override description =
    'Edit an existing file by applying text replacements. Include 1-3 lines of surrounding context in oldText to make matches unambiguous. Use contextBefore/contextAfter anchors when the same text appears in multiple places.';
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
        return {
          path: absolutePath,
          success: false,
          changed: false,
          error: true,
          message: `File "${args.path}" does not exist.`,
          recovery: {
            suggestion: 'Create the file first with write_file.',
          },
        };
      }
      throw error;
    }

    let updatedContent = originalContent;
    let totalReplacements = 0;

    for (const [index, edit] of args.edits.entries()) {
      const result = findInContent(
        updatedContent,
        edit.oldText,
        edit.contextBefore,
        edit.contextAfter
      );

      if (result.index < 0 && 'error' in result) {
        return {
          path: absolutePath,
          success: false,
          changed: false,
          error: true,
          message: `Edit ${index + 1}: ${result.error.message}`,
          recovery: {
            suggestion: `The file may have changed or whitespace differs.`,
            fileSnippet: result.error.fileSnippet,
            retryHint: result.error.retryHint,
          },
        };
      }

      if (result.index >= 0 && 'matchType' in result) {
        const searchText = result.matchedText;
        const occurrences = countOccurrences(updatedContent, searchText);

        if (!edit.replaceAll && occurrences > 1 && result.matchType === 'exact') {
          return {
            path: absolutePath,
            success: false,
            changed: false,
            error: true,
            message: `Edit ${index + 1} matched ${occurrences} locations. Provide more context in oldText or use contextBefore/contextAfter to disambiguate.`,
            recovery: {
              retryHint:
                'Re-read the file and include 1-3 lines of unique surrounding context in oldText. Or set replaceAll: true if all matches should be replaced.',
            },
          };
        }

        updatedContent = edit.replaceAll
          ? updatedContent.split(searchText).join(edit.newText)
          : replaceFirstOccurrence(updatedContent, searchText, edit.newText);

        totalReplacements += edit.replaceAll ? occurrences : 1;
      }
    }

    const changed = updatedContent !== originalContent;
    const diff = changed
      ? generateUnifiedDiff(args.path, originalContent, updatedContent)
      : '';

    if (changed) {
      await fs.writeFile(absolutePath, updatedContent, {
        encoding: args.encoding as BufferEncoding,
      });
      clearFileReadCaches();
    }

    return {
      path: absolutePath,
      success: true,
      changed,
      appliedEditCount: args.edits.length,
      totalReplacements,
      ...(diff ? { diff } : {}),
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
    const recursive = Boolean(args.recursive);
    const cacheKey = JSON.stringify([absolutePath, recursive]);
    const cached = getCached(listDirCache, cacheKey);
    if (cached !== undefined) return cached;

    return setCached(listDirCache, cacheKey, await listDirEntries(absolutePath, recursive));
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
    clearFileReadCaches();
    return { path: absolutePath, deleted: true };
  }
}
