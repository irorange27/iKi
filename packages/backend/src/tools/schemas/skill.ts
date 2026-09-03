import { z } from 'zod';

import {
  DEFAULT_PERSONAL_SKILL_LIST_LIMIT,
  DEFAULT_PERSONAL_SKILL_READ_MAX_CHARS,
  toolCallDescriptionField,
  uiSchema,
} from './shared';

const loadSkillInputFields = {
  id: z.string().describe('Exact selected skill id to load'),
};

const personalSkillIdInputFields = {
  id: z
    .string()
    .describe('Exact personal skill id, for example "user:planner" or "user:team/planner"'),
};

// ---------------------------------------------------------------------------
// Load skill (harness-level skill activation) schemas
// ---------------------------------------------------------------------------

export const LoadSkillInputSchema = z.object({
  id: loadSkillInputFields.id,
  description: toolCallDescriptionField,
});

const loadSkillInputShape = {
  id: loadSkillInputFields.id,
  description: toolCallDescriptionField,
};

export const LoadSkillInputSchemaUi = uiSchema(loadSkillInputShape);

// ---------------------------------------------------------------------------
// Personal Skills schemas
// ---------------------------------------------------------------------------

const listPersonalSkillsInputShape = {
  query: z.string().trim().describe('Optional search text for matching personal skills').optional(),
  limit: z
    .number()
    .int()
    .describe('Maximum number of personal skills to return')
    .optional()
    .default(DEFAULT_PERSONAL_SKILL_LIST_LIMIT),
  description: toolCallDescriptionField,
};

export const ListPersonalSkillsInputSchema = z.object(listPersonalSkillsInputShape);
export const ListPersonalSkillsInputSchemaUi = uiSchema(listPersonalSkillsInputShape);

const readPersonalSkillInputShape = {
  id: personalSkillIdInputFields.id,
  maxChars: z
    .number()
    .int()
    .describe('Maximum number of characters to return from the personal skill file')
    .optional()
    .default(DEFAULT_PERSONAL_SKILL_READ_MAX_CHARS),
  description: toolCallDescriptionField,
};

export const ReadPersonalSkillInputSchema = z.object(readPersonalSkillInputShape);
export const ReadPersonalSkillInputSchemaUi = uiSchema(readPersonalSkillInputShape);

const writePersonalSkillInputShape = {
  id: personalSkillIdInputFields.id,
  skillName: z
    .string()
    .trim()
    .describe('Optional display name to store in the skill frontmatter')
    .optional(),
  skillDescription: z
    .string()
    .trim()
    .describe('Optional short summary to store in the skill frontmatter')
    .optional(),
  instructions: z
    .string()
    .trim()
    .min(1)
    .describe('Markdown instructions body to store below the generated frontmatter'),
  description: toolCallDescriptionField,
};

export const WritePersonalSkillInputSchema = z.object(writePersonalSkillInputShape);
export const WritePersonalSkillInputSchemaUi = uiSchema(writePersonalSkillInputShape);

export const DeletePersonalSkillInputSchema = z.object({
  id: personalSkillIdInputFields.id,
  description: toolCallDescriptionField,
});

const deletePersonalSkillInputShape = {
  id: personalSkillIdInputFields.id,
  description: toolCallDescriptionField,
};

export const DeletePersonalSkillInputSchemaUi = uiSchema(deletePersonalSkillInputShape);
