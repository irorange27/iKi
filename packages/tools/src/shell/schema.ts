import { z } from 'zod';

const toolCallDescriptionField = z
  .string()
  .trim()
  .max(160)
  .describe(
    'REQUIRED in practice: one short sentence (max 160 chars) stating WHY you are calling this tool right now. ' +
      'This is shown to the user in the UI as the tool-call title — always include it, even when the reason seems obvious.'
  )
  .optional();

export const ShellToolInputSchema = z.object({
  command: z.string().describe('The command to execute'),
  cwd: z.string().describe('Working directory (defaults to the active workspace)').optional(),
  timeout: z
    .number()
    .describe(
      'Foreground wait timeout in milliseconds (defaults to settings.tools.shell.defaultTimeoutMs). When still running after timeout, promotes to a durable background job if promoteOnTimeout is enabled.'
    )
    .optional(),
  background: z
    .boolean()
    .describe('Start immediately as a durable background job and return its jobId without waiting.')
    .optional(),
  killOnTimeout: z
    .boolean()
    .describe('Kill the process instead of promoting to a background job when timeout elapses.')
    .optional(),
  description: toolCallDescriptionField,
});

export const JobToolInputSchema = z.object({
  action: z
    .enum(['list', 'output', 'wait', 'kill'])
    .describe(
      'list: show background jobs; output: read incremental/tail log without blocking; wait: wait up to waitMs for completion and return output; kill: terminate a running job.'
    ),
  jobId: z.string().describe('Target job id (required for output, wait, kill)').optional(),
  offset: z
    .number()
    .int()
    .nonnegative()
    .describe('Byte offset in the job log to read from (use previous nextOffset for incremental reads)')
    .optional(),
  waitMs: z
    .number()
    .int()
    .positive()
    .describe('Maximum milliseconds to wait when action="wait" (defaults to settings.tools.shell.defaultWaitMs)')
    .optional(),
  allThreads: z
    .boolean()
    .describe('When action="list", include jobs from all threads instead of only the current thread')
    .optional(),
  description: toolCallDescriptionField,
});
