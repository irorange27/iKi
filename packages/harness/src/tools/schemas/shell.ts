import { z } from 'zod';

import { DEFAULT_SHELL_TIMEOUT_MS, toolCallDescriptionField } from './shared';

export const ShellToolInputSchema = z.object({
  command: z.string().describe('The shell command to execute'),
  cwd: z.string().describe('The working directory in which to execute the command').optional(),
  timeout: z
    .number()
    .describe('Command timeout in milliseconds')
    .optional()
    .default(DEFAULT_SHELL_TIMEOUT_MS),
  description: toolCallDescriptionField,
});
