import { z } from 'zod';

import { DEFAULT_FILE_ENCODING, MAX_EDIT_FILE_OPERATIONS, toolCallDescriptionField, uiSchema } from './shared';

const readFileInputFields = {
  path: z.string().describe('Absolute path or workspace-relative path to the file to read'),
  encoding: z.string().describe('File encoding'),
};

const writeFileInputFields = {
  path: z.string().describe('Absolute path or workspace-relative path to the file to write'),
  content: z.string().describe('The content to write to the file'),
  encoding: z.string().describe('File encoding'),
};

const editFileOperationInputSchema = z.object({
  oldText: z
    .string()
    .min(1)
    .describe('Text to replace. Include 1-3 lines of surrounding context to make the match unambiguous.'),
  newText: z.string().describe('Replacement text. Use an empty string to delete the matched text.'),
  replaceAll: z
    .boolean()
    .optional()
    .default(false)
    .describe('Replace every match instead of requiring a single unambiguous match'),
  contextBefore: z
    .string()
    .optional()
    .describe('A few lines of text immediately before the target. Anchors the search when similar text appears in multiple places.'),
  contextAfter: z
    .string()
    .optional()
    .describe('A few lines of text immediately after the target. Anchors the search when similar text appears in multiple places.'),
});

const editFileInputFields = {
  path: z
    .string()
    .describe('Absolute path or workspace-relative path to the existing file to edit'),
  edits: z
    .array(editFileOperationInputSchema)
    .min(1)
    .max(MAX_EDIT_FILE_OPERATIONS)
    .describe(
      `Ordered exact-text replacement operations to apply sequentially. Provide at most ${MAX_EDIT_FILE_OPERATIONS} edits per call.`
    ),
  encoding: z.string().describe('File encoding'),
};

const deleteFileInputFields = {
  path: z.string().describe('Absolute path or workspace-relative path to the file to delete'),
};

// ---------------------------------------------------------------------------
// Read file schemas
// ---------------------------------------------------------------------------

const readFileInputShape = {
  path: readFileInputFields.path,
  encoding: readFileInputFields.encoding.optional().default(DEFAULT_FILE_ENCODING),
  description: toolCallDescriptionField,
};

export const ReadFileInputSchema = z.object(readFileInputShape);
export const ReadFileInputSchemaUi = uiSchema(readFileInputShape);

// ---------------------------------------------------------------------------
// Write file schemas
// ---------------------------------------------------------------------------

const writeFileInputShape = {
  path: writeFileInputFields.path,
  content: writeFileInputFields.content,
  encoding: writeFileInputFields.encoding.optional().default(DEFAULT_FILE_ENCODING),
  description: toolCallDescriptionField,
};

export const WriteFileInputSchema = z.object(writeFileInputShape);
export const WriteFileInputSchemaUi = uiSchema(writeFileInputShape);

// ---------------------------------------------------------------------------
// Edit file schemas
// ---------------------------------------------------------------------------

const editFileInputShape = {
  path: editFileInputFields.path,
  edits: editFileInputFields.edits,
  encoding: editFileInputFields.encoding.optional().default(DEFAULT_FILE_ENCODING),
  description: toolCallDescriptionField,
};

export const EditFileInputSchema = z.object(editFileInputShape);
export const EditFileInputSchemaUi = uiSchema(editFileInputShape);

// ---------------------------------------------------------------------------
// Undo edit schemas
// ---------------------------------------------------------------------------

const undoEditInputFields = {
  path: z
    .string()
    .describe('Path of the file whose most recent edit_file change should be reverted'),
};

const undoEditInputShape = {
  path: undoEditInputFields.path,
  description: toolCallDescriptionField,
};

export const UndoEditInputSchema = z.object(undoEditInputShape);
export const UndoEditInputSchemaUi = uiSchema(undoEditInputShape);

// ---------------------------------------------------------------------------
// Delete file schemas
// ---------------------------------------------------------------------------

export const DeleteFileInputSchema = z.object({
  path: deleteFileInputFields.path,
  description: toolCallDescriptionField,
});

const deleteFileInputShape = {
  path: deleteFileInputFields.path,
  description: toolCallDescriptionField,
};

export const DeleteFileInputSchemaUi = uiSchema(deleteFileInputShape);
