import { z } from 'zod';

import {
  createProactiveTask,
  deleteProactiveTask,
  listProactiveTaskRecords,
  readProactiveTaskRecord,
  updateProactiveTask,
  type ProactiveTaskUpdateInput,
} from '../tasks/proactive_task_manager';
import { BaseTool } from '@iki/core/tools/base';
import { zodSchemaToJsonSchema } from '@iki/core/tools/json_schema';
import { getToolRuntimeContext } from '@iki/core/tools/runtime_context';
import {
  DeleteProactiveTaskInputSchema,
  DeleteProactiveTaskOutputSchema,
  ListProactiveTasksInputSchema,
  ListProactiveTasksOutputSchema,
  ReadProactiveTaskInputSchema,
  ReadProactiveTaskOutputSchema,
  WriteProactiveTaskInputSchema,
  WriteProactiveTaskOutputSchema,
} from './schemas';

const WEEKDAY_TO_CRON: Record<'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun', string> = {
  mon: 'MON',
  tue: 'TUE',
  wed: 'WED',
  thu: 'THU',
  fri: 'FRI',
  sat: 'SAT',
  sun: 'SUN',
};

const parseTimeOfDay = (value: string): { hour: number; minute: number } => {
  const trimmed = value.trim();
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(trimmed);
  if (!match) {
    throw new Error('Expected HH:MM 24-hour time');
  }

  return {
    hour: Number(match[1]),
    minute: Number(match[2]),
  };
};

const toStoredSchedule = (schedule: z.infer<typeof WriteProactiveTaskInputSchema>['schedule']) => {
  if (!schedule) return {};

  if (schedule.kind === 'interval') {
    return {
      schedule_type: 'interval' as const,
      interval_minutes: schedule.intervalMinutes,
      cron_expression: null,
      schedule_timezone: null,
    };
  }

  if (schedule.kind === 'cron') {
    return {
      schedule_type: 'cron' as const,
      interval_minutes: 60,
      cron_expression: schedule.cronExpression,
      schedule_timezone: schedule.timezone?.trim() || null,
    };
  }

  const { hour, minute } = parseTimeOfDay(schedule.time);
  const cronBase = `${minute} ${hour} * * `;
  if (schedule.kind === 'daily') {
    return {
      schedule_type: 'cron' as const,
      interval_minutes: 60 * 24,
      cron_expression: `${minute} ${hour} * * *`,
      schedule_timezone: schedule.timezone?.trim() || null,
    };
  }

  const days = schedule.daysOfWeek.map(day => WEEKDAY_TO_CRON[day]).join(',');
  return {
    schedule_type: 'cron' as const,
    interval_minutes: 60 * 24 * 7,
    cron_expression: `${cronBase}${days}`,
    schedule_timezone: schedule.timezone?.trim() || null,
  };
};

const resolveDeliveryThreadId = (params: {
  delivery?: 'current_thread' | 'dedicated_thread' | 'specific_thread';
  explicitThreadId?: string;
  defaultToCurrentThread?: boolean;
}) => {
  const runtimeThreadId = getToolRuntimeContext().threadId?.trim() || '';
  const explicitThreadId = params.explicitThreadId?.trim() || '';
  const delivery =
    params.delivery ||
    (explicitThreadId
      ? 'specific_thread'
      : params.defaultToCurrentThread && runtimeThreadId
        ? 'current_thread'
        : 'dedicated_thread');

  if (delivery === 'dedicated_thread') return null;
  if (delivery === 'specific_thread') {
    if (!explicitThreadId) {
      throw new Error('threadId is required when delivery is specific_thread');
    }
    return explicitThreadId;
  }
  if (!runtimeThreadId) {
    throw new Error('Current chat thread is unavailable for current_thread delivery');
  }
  return runtimeThreadId;
};

const resolveConversationModelDefaults = (args: z.infer<typeof WriteProactiveTaskInputSchema>) => {
  const runtimeModel = getToolRuntimeContext().conversationModel;
  const explicitProviderType = args.providerType?.trim() || '';
  const providerType = explicitProviderType || runtimeModel?.providerType?.trim() || '';
  const providerTypeMatchesRuntime =
    !explicitProviderType ||
    (runtimeModel?.providerType?.trim() || '') === explicitProviderType;

  const model =
    args.model?.trim() ||
    (providerTypeMatchesRuntime ? runtimeModel?.model?.trim() || '' : '');
  const providerId =
    args.providerId?.trim() ||
    (providerTypeMatchesRuntime ? runtimeModel?.providerId?.trim() || '' : '');

  if (!providerType) {
    throw new Error('providerType is required when no current chat model is available');
  }
  if (!model) {
    throw new Error('model is required when it cannot be inferred from the current chat');
  }

  return {
    provider_type: providerType,
    provider_id: providerId || null,
    model,
  };
};

export class ListProactiveTasksTool extends BaseTool {
  override name = 'list_proactive_tasks';
  override displayName = 'List Proactive Tasks';
  override type = 'function';
  override autoAllowed = true;
  override needsApproval = false;
  override description =
    'List persistent proactive tasks so you can inspect, update, or delete an existing recurring task.';
  override paramSchema = ListProactiveTasksInputSchema;
  override outputSchema = zodSchemaToJsonSchema(ListProactiveTasksOutputSchema, {
    title: 'list_proactive_tasks_output',
  });

  protected override async handler(args: z.infer<typeof this.paramSchema>) {
    const tasks = listProactiveTaskRecords({
      query: args.query,
      limit: args.limit,
    });

    return {
      tasks,
      resultCount: tasks.length,
    };
  }
}

export class ReadProactiveTaskTool extends BaseTool {
  override name = 'read_proactive_task';
  override displayName = 'Read Proactive Task';
  override type = 'function';
  override autoAllowed = true;
  override needsApproval = false;
  override description = 'Read a proactive task by id or exact name.';
  override paramSchema = ReadProactiveTaskInputSchema;
  override outputSchema = zodSchemaToJsonSchema(ReadProactiveTaskOutputSchema, {
    title: 'read_proactive_task_output',
  });

  protected override async handler(args: z.infer<typeof this.paramSchema>) {
    return {
      task: readProactiveTaskRecord({
        id: args.id,
        name: args.name,
      }),
    };
  }
}

export class WriteProactiveTaskTool extends BaseTool {
  override name = 'write_proactive_task';
  override displayName = 'Write Proactive Task';
  override type = 'function';
  override autoAllowed = true;
  override needsApproval = true;
  override approvalMode = 'always' as const;
  override description =
    'Create or update a persistent proactive task. New tasks default to posting into the current chat thread and using the current chat model unless you override them.';
  override paramSchema = WriteProactiveTaskInputSchema;
  override outputSchema = zodSchemaToJsonSchema(WriteProactiveTaskOutputSchema, {
    title: 'write_proactive_task_output',
  });

  protected override async handler(args: z.infer<typeof this.paramSchema>) {
    const schedule = toStoredSchedule(args.schedule);
    const toolConfig =
      args.toolMode || args.tools
        ? {
            tool_mode: args.toolMode,
            tools: args.tools,
          }
        : {};

    if (args.action === 'create') {
      const modelDefaults = resolveConversationModelDefaults(args);
      const task = createProactiveTask({
        name: args.name?.trim() || '',
        prompt: args.prompt?.trim() || '',
        enabled: args.enabled,
        notify: args.notify,
        thread_id: resolveDeliveryThreadId({
          delivery: args.delivery,
          explicitThreadId: args.threadId,
          defaultToCurrentThread: true,
        }),
        ...modelDefaults,
        ...schedule,
        ...toolConfig,
      });

      return {
        action: 'created' as const,
        task: readProactiveTaskRecord({ id: task.id }),
      };
    }

    const updatePayload: ProactiveTaskUpdateInput = {};
    if (typeof args.name === 'string') updatePayload.name = args.name.trim();
    if (typeof args.prompt === 'string') updatePayload.prompt = args.prompt.trim();
    if (typeof args.enabled === 'boolean') updatePayload.enabled = args.enabled;
    if (typeof args.notify === 'boolean') updatePayload.notify = args.notify;
    if (args.schedule) Object.assign(updatePayload, schedule);
    if (args.delivery || typeof args.threadId === 'string') {
      updatePayload.thread_id = resolveDeliveryThreadId({
        delivery: args.delivery,
        explicitThreadId: args.threadId,
        defaultToCurrentThread: false,
      });
    }
    if (
      typeof args.providerType === 'string' ||
      typeof args.providerId === 'string' ||
      typeof args.model === 'string'
    ) {
      Object.assign(updatePayload, resolveConversationModelDefaults(args));
    }
    if (args.toolMode || args.tools) {
      Object.assign(updatePayload, toolConfig);
    }

    const task = updateProactiveTask(
      {
        id: args.id,
        name: args.currentName,
      },
      updatePayload
    );

    return {
      action: 'updated' as const,
      task: readProactiveTaskRecord({ id: task.id }),
    };
  }
}

export class DeleteProactiveTaskTool extends BaseTool {
  override name = 'delete_proactive_task';
  override displayName = 'Delete Proactive Task';
  override type = 'function';
  override autoAllowed = true;
  override needsApproval = true;
  override approvalMode = 'always' as const;
  override description = 'Delete a proactive task by id or exact name.';
  override paramSchema = DeleteProactiveTaskInputSchema;
  override outputSchema = zodSchemaToJsonSchema(DeleteProactiveTaskOutputSchema, {
    title: 'delete_proactive_task_output',
  });

  protected override async handler(args: z.infer<typeof this.paramSchema>) {
    return deleteProactiveTask({
      id: args.id,
      name: args.name,
    });
  }
}
