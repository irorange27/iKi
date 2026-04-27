import { z } from 'zod';

import { BaseTool } from './base';

export const FinishInputSchema = z.object({
  summary: z
    .string()
    .optional()
    .describe('Brief summary of what was accomplished.'),
});

export class FinishTool extends BaseTool<typeof FinishInputSchema> {
  override name = 'finish';
  override displayName = 'Finish';
  override type = 'function';
  override autoAllowed = true;
  override needsApproval = false;
  override description =
    'Signal that the current task or autonomous run is complete. Call this tool when you have finished all the work requested and want to stop gracefully. Include an optional summary of what was done.';
  override paramSchema = FinishInputSchema;

  protected override async handler(args: z.infer<typeof this.paramSchema>) {
    return {
      success: true,
      summary: (args.summary ?? 'Task completed.').trim() || 'Task completed.',
    };
  }
}
