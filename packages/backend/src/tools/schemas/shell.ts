import { z } from 'zod';

import { DEFAULT_SHELL_TIMEOUT_MS, toolCallDescriptionField, uiSchema } from './shared';

const shellInputFields = {
  command: z.string().describe('The shell command to execute'),
  cwd: z.string().describe('The working directory in which to execute the command'),
  timeout: z.number().describe('Command timeout in milliseconds'),
};

// ---------------------------------------------------------------------------
// Shell tool schemas
// ---------------------------------------------------------------------------

const shellToolInputShape = {
  command: shellInputFields.command,
  cwd: shellInputFields.cwd.optional(),
  timeout: shellInputFields.timeout.optional().default(DEFAULT_SHELL_TIMEOUT_MS),
  description: toolCallDescriptionField,
};

export const ShellToolInputSchema = z.object(shellToolInputShape);
export const ShellToolInputSchemaUi = uiSchema(shellToolInputShape);
