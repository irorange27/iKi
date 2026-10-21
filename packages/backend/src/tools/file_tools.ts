import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { getToolRuntimeContext } from '../utils/runtime_context';
import { BaseTool } from '@iki/backend/tools/base';
import {
  DeleteFileInputSchema,
  EditFileInputSchema,
  ReadFileInputSchema,
  UndoEditInputSchema,
  WriteFileInputSchema,
} from './schemas';
import { checkEditedFileSyntax } from './lint_gate';
import {
  resolveDeleteWorkspacePath,
  resolveReadableWorkspacePath,
  resolveWritableWorkspacePath,
  type ResolvedWorkspacePath,
} from './workspace_paths';

const MAX_EDIT_UNDO_DEPTH = 10;
const editUndoStacks = new Map<string, Array<{ previousContent: string; writtenContent: string; encoding: BufferEncoding }>>();
const undoKey = (filePath: string): string => JSON.stringify([getToolRuntimeContext().threadId ?? null, filePath]);

const writeFileAtomically = async (
  absolutePath: string,
  content: string,
  encoding: BufferEncoding
): Promise<void> => {
  const tempPath = `${absolutePath}.tmp-${randomUUID()}`;
  await fs.writeFile(tempPath, content, { encoding });
  try {
    await fs.rename(tempPath, absolutePath);
  } catch (error) {
    await fs.rm(tempPath, { force: true }).catch((): Promise<void> => undefined);
    throw error;
  }
};

const pathWriteLocks = new Map<string, Promise<unknown>>();

const withPathWriteLock = <T>(absolutePath: string, fn: () => Promise<T>): Promise<T> => {
  const previous = pathWriteLocks.get(absolutePath) ?? Promise.resolve();
  const run = previous.then(fn, fn);
  const settled = run.then(
    (): Promise<void> => Promise.resolve(),
    (): Promise<void> => Promise.resolve()
  );
  const release = settled.then(() => {
    if (pathWriteLocks.get(absolutePath) === release) {
      pathWriteLocks.delete(absolutePath);
    }
  });
  pathWriteLocks.set(absolutePath, release);
  return run;
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

  const exactPos = content.indexOf(oldText);
  if (exactPos >= 0) {
    const count = countOccurrences(content, oldText);
    if (count === 1) {
      return { index: exactPos, matchType: 'exact', matchedText: oldText };
    }

    if (contextBefore || contextAfter) {

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

    return { index: exactPos, matchType: 'exact', matchedText: oldText };
  }

  const contentLines = content.split('\n');
  const searchLines = oldText.split('\n');
  const fuzzyPos = fuzzyLineMatch(contentLines, searchLines, 0);
  if (fuzzyPos >= 0) {

    const matchedText = contentLines.slice(fuzzyPos, fuzzyPos + searchLines.length).join('\n');
    const charPos = content.indexOf(matchedText);
    return { index: Math.max(0, charPos), matchType: 'fuzzy', matchedText };
  }

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
  override replay = 'safe' as const;
  override description = 'Read the content of a file from the local filesystem.';

  override paramSchema = ReadFileInputSchema;

  protected override async handler(args: z.infer<typeof this.paramSchema>) {
    const resolved = await resolveReadableWorkspacePath(args.path);
    const content = await fs.readFile(resolved.validated, { encoding: args.encoding as BufferEncoding });
    return { path: resolved.display, content };
  }
}

export class WriteFileTool extends BaseTool {
  override name = 'write_file';
  override type = 'function';
  override autoAllowed = true;

  override replay = 'unsafe' as const;
  override description = 'Write or overwrite content to a file on the local filesystem.';
  override needsApproval = true;
  override paramSchema = WriteFileInputSchema;

  protected override async handler(args: z.infer<typeof this.paramSchema>) {
    const resolved = await resolveWritableWorkspacePath(args.path);

    return await withPathWriteLock(resolved.validated, async () => {
      getToolRuntimeContext().abortSignal?.throwIfAborted();

      await fs.mkdir(path.dirname(resolved.validated), { recursive: true });

      getToolRuntimeContext().abortSignal?.throwIfAborted();

      await writeFileAtomically(resolved.validated, args.content, args.encoding as BufferEncoding);

      return { path: resolved.display, success: true };
    });
  }
}

export class EditFileTool extends BaseTool {
  override name = 'edit';
  override type = 'function';
  override autoAllowed = true;

  override replay = 'unsafe' as const;
  override description =
    'Edit an existing file by applying text replacements. Include 1-3 lines of surrounding context in oldText to make matches unambiguous. Use contextBefore/contextAfter anchors when the same text appears in multiple places. Edited files are syntax-checked before writing (JSON, Python, JS); syntax-breaking edits are rejected and the file stays untouched. Revert the most recent edit to a file with undo_edit.';
  override needsApproval = true;
  override paramSchema = EditFileInputSchema;

  protected override async handler(args: z.infer<typeof this.paramSchema>) {
    const resolved = await resolveWritableWorkspacePath(args.path);
    return await withPathWriteLock(resolved.validated, () => this.applyEdits(resolved, args));
  }

  private async applyEdits(
    resolved: ResolvedWorkspacePath,
    args: z.infer<typeof this.paramSchema>
  ) {
    let originalContent: string;
    try {
      originalContent = await fs.readFile(resolved.validated, {
        encoding: args.encoding as BufferEncoding,
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return {
          path: resolved.display,
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
          path: resolved.display,
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
            path: resolved.display,
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

      const syntaxVerdict = await checkEditedFileSyntax(resolved.validated, updatedContent);
      if (syntaxVerdict.status === 'failed') {
        return {
          path: resolved.display,
          success: false,
          changed: false,
          error: true,
          message: `Edit rejected: ${syntaxVerdict.checker} syntax check failed. The file was not modified.`,
          recovery: {
            suggestion: 'Fix the reported syntax error and retry the edit with corrected newText.',
            fileSnippet: syntaxVerdict.output,
          },
        };
      }

      getToolRuntimeContext().abortSignal?.throwIfAborted();
      await writeFileAtomically(resolved.validated, updatedContent, args.encoding as BufferEncoding);
      const undoStack = editUndoStacks.get(undoKey(resolved.validated)) ?? [];
      undoStack.push({
        previousContent: originalContent,
        writtenContent: updatedContent,
        encoding: args.encoding as BufferEncoding,
      });
      if (undoStack.length > MAX_EDIT_UNDO_DEPTH) undoStack.shift();
      editUndoStacks.set(undoKey(resolved.validated), undoStack);

      return {
        path: resolved.display,
        success: true,
        changed,
        appliedEditCount: args.edits.length,
        totalReplacements,
        syntaxCheck: syntaxVerdict.status === 'ok' ? 'checked' : 'skipped',
        ...(diff ? { diff } : {}),
      };
    }

    return {
      path: resolved.display,
      success: true,
      changed,
      appliedEditCount: args.edits.length,
      totalReplacements,
      ...(diff ? { diff } : {}),
    };
  }
}

export class UndoEditTool extends BaseTool {
  override name = 'undo_edit';
  override type = 'function';
  override autoAllowed = true;

  override replay = 'unsafe' as const;
  override description =
    'Revert the most recent successful edit_file change to the given file, restoring the content from before that edit. Only edits made during this session can be undone.';
  override needsApproval = true;
  override paramSchema = UndoEditInputSchema;

  protected override async handler(args: z.infer<typeof this.paramSchema>) {
    const resolved = await resolveWritableWorkspacePath(args.path);
    return await withPathWriteLock(resolved.validated, () => this.applyUndo(resolved, args));
  }

  private async applyUndo(resolved: ResolvedWorkspacePath, args: z.infer<typeof this.paramSchema>) {
    const undoStack = editUndoStacks.get(undoKey(resolved.validated));
    const entry = undoStack?.at(-1);
    if (!undoStack || !entry) {
      return {
        path: resolved.display,
        success: false,
        error: true,
        message: `No edit_file changes to undo for "${args.path}" in this session.`,
        recovery: {
          suggestion: 'Only edits applied by edit_file during this session can be undone.',
        },
      };
    }

    const currentContent = await fs.readFile(resolved.validated, { encoding: entry.encoding });
    if (currentContent !== entry.writtenContent) {
      return { path: resolved.display, success: false, error: true, message: 'File changed since this edit; refusing to overwrite newer changes.' };
    }
    getToolRuntimeContext().abortSignal?.throwIfAborted();
    await writeFileAtomically(resolved.validated, entry.previousContent, entry.encoding);
    undoStack.pop();
    return {
      path: resolved.display,
      success: true,
      restored: true,
      editsRemaining: undoStack.length,
    };
  }
}

export class DeleteFileTool extends BaseTool {
  override name = 'delete_file';
  override type = 'function';
  override needsApproval = true;
  override replay = 'unsafe' as const;
  override description = 'Delete a file from the local filesystem. BE CAREFUL with this tool.';

  override paramSchema = DeleteFileInputSchema;

  protected override async handler(args: z.infer<typeof this.paramSchema>) {
    const resolved = await resolveDeleteWorkspacePath(args.path);

    getToolRuntimeContext().abortSignal?.throwIfAborted();
    await fs.unlink(resolved.validated);
    return { path: resolved.display, deleted: true };
  }
}
