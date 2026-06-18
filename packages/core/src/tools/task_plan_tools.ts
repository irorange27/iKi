import { z } from 'zod';

import { writeThreadTodoPlan } from '@iki/backend/db/thread_todos';
import { renderTaskPlan, summarizeTaskPlan } from '@iki/backend/db/task_plan';
import { BaseTool } from './base';
import { zodSchemaToJsonSchema } from './json_schema';
import { getToolRuntimeContext } from './runtime_context';
import { TodoToolInputSchema, TodoToolOutputSchema } from './schemas';

export class TodoTool extends BaseTool {
  override name = 'todo';
  override displayName = 'Todo';
  override type = 'function';
  override autoAllowed = true;
  override needsApproval = false;
  override description =
    'Track progress on the current multi-step task inside this chat thread. Use it to keep a visible plan with pending, in_progress, and completed states.';
  override paramSchema = TodoToolInputSchema;
  override outputSchema = zodSchemaToJsonSchema(TodoToolOutputSchema, {
    title: 'todo_output',
  });

  protected override async handler(args: z.infer<typeof this.paramSchema>) {
    const threadId = getToolRuntimeContext().threadId;
    const plan = writeThreadTodoPlan({
      threadId: typeof threadId === 'string' ? threadId : '',
      items: args.items,
    });
    const summary = summarizeTaskPlan(plan.items);

    return {
      items: plan.items,
      rendered: renderTaskPlan(plan.items),
      totalCount: summary.totalCount,
      completedCount: summary.completedCount,
      inProgressCount: summary.inProgressCount,
      pendingCount: summary.pendingCount,
    };
  }
}
