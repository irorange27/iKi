import { z } from 'zod';

import { BaseTool } from './base';

export const HandoffInputSchema = z.object({
  summary: z
    .string()
    .describe('Summary of what has been accomplished so far.'),
  next_steps: z
    .string()
    .describe('What the next agent should do to continue the work. Be specific about remaining tasks.'),
  reason: z
    .enum(['task_too_large', 'context_limit', 'user_interrupted', 'approaching_limit', 'other'])
    .describe('Why the handoff is happening.'),
});

export class HandoffTool extends BaseTool<typeof HandoffInputSchema> {
  override name = 'handoff';
  override displayName = 'Handoff';
  override type = 'function';
  override autoAllowed = true;
  override needsApproval = false;
  override description =
    'Hand off the current task to another agent instance. Call this tool when you cannot or should not continue — for example when the task is too large for one session, you are approaching context limits, or the user asked to pause. Provide a clear summary of what was done and what remains so the next agent can pick up seamlessly.';
  override paramSchema = HandoffInputSchema;

  protected override async handler(args: z.infer<typeof this.paramSchema>) {
    return {
      success: true,
      summary: args.summary.trim(),
      next_steps: args.next_steps.trim(),
      reason: args.reason,
    };
  }
}
