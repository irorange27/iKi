import { Notification, app } from 'electron';

import * as tasksDb from '../../../core/db/tasks';
import * as chatThreadDb from '../../../core/db/chat_thread';
import { createLogger } from '../../../core/logger';
import { clampIntervalMinutes, computeNextRunAt } from '../../../core/tasks/task_schedule';
import { deliverBridgeThreadMessage } from '../../../daemon/bridge_dispatch';
import {
  filterSafeProactiveTaskTools,
  inferProactiveTaskToolMode,
  parseProactiveTaskTools,
  type ProactiveTask,
} from '../../../shared/types/tasks';
import { createPrefixedId } from '../../../shared/utils/id';
import { toIsoNow } from '../../../shared/utils/text';
import { chatService } from '../chat/chat_service';
import { companionService } from '../companion/companion_service';
import { getErrorMessage } from '../../utils/errors';
import { getAllBrowserWindows } from '../../utils/browser_windows';

const SCHEDULER_TICK_MS = 30_000;
const proactiveTaskLogger = createLogger({ module: 'proactive_tasks' });

let schedulerTimer: NodeJS.Timeout | null = null;
let tickInFlight = false;
const taskInFlight = new Set<string>();

const PROACTIVE_TASK_AGENT_SYSTEM_PROMPT = [
  'You are executing a scheduled proactive task for the user.',
  'Act autonomously and complete the task without asking the user follow-up questions.',
  'When the task depends on current information, proactively use the available tools to verify freshness instead of relying on stale model knowledge.',
  'Prefer concise, high-signal updates that emphasize material changes, concrete dates, and actionable conclusions.',
  'Avoid repeating unchanged background from prior runs. If nothing important changed, say so plainly.',
  'When you cite current information, include source links or source names when practical.',
].join('\n');

const clipText = (value: string | null | undefined, maxChars: number): string => {
  if (!value) return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (trimmed.length <= maxChars) return trimmed;
  return `${trimmed.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`;
};

const formatTaskSchedule = (task: {
  schedule_type?: string;
  interval_minutes: number;
  cron_expression?: string | null;
  schedule_timezone?: string | null;
}): string =>
  task.schedule_type === 'cron'
    ? `${task.cron_expression || 'cron'}${task.schedule_timezone ? ` (${task.schedule_timezone})` : ' (local time)'}`
    : `every ${clampIntervalMinutes(task.interval_minutes)} minute(s)`;

const formatTaskToolStrategy = (task: Pick<ProactiveTask, 'tool_mode' | 'tools'>): string => {
  const toolMode = inferProactiveTaskToolMode(task);
  if (toolMode === 'auto')
    return 'Agent decides automatically using the safe built-in tool catalog.';
  if (toolMode === 'disabled') return 'Tools disabled; run as plain model reasoning only.';

  const tools = filterSafeProactiveTaskTools(parseProactiveTaskTools(task.tools));
  return tools.length > 0
    ? `Manual safe tools: ${tools.join(', ')}`
    : 'Manual tool mode configured, but no safe tools remain enabled.';
};

const buildProactiveTaskPrompt = (
  task: ProactiveTask,
  params: { startedAt: string; reason: 'schedule' | 'manual' }
): string => {
  const previousRunAt = task.last_run_at?.trim();
  const previousOutput = clipText(task.last_output, 1200);
  const previousError = clipText(task.last_error, 500);

  const sections = [
    `Task name: ${task.name}`,
    `Run reason: ${params.reason}`,
    `Current run time (ISO): ${params.startedAt}`,
    `Schedule: ${formatTaskSchedule(task)}`,
    `Tool strategy: ${formatTaskToolStrategy(task)}`,
    previousRunAt ? `Previous run time (ISO): ${previousRunAt}` : 'Previous run time (ISO): none',
    task.last_status ? `Previous run status: ${task.last_status}` : '',
    previousError ? `Previous run error:\n${previousError}` : '',
    previousOutput ? `Previous run output excerpt:\n${previousOutput}` : '',
    `Objective:\n${task.prompt}`,
    [
      'Execution instructions:',
      '- Complete the task now without asking the user follow-up questions.',
      '- Use tools proactively when they materially improve freshness or correctness.',
      '- Prioritize deltas, newly relevant developments, and decisions the user may need to make.',
      '- Keep the final answer concise and avoid repeating unchanged context.',
    ].join('\n'),
  ];

  return sections.filter(Boolean).join('\n\n');
};

const sendPushEventToRenderers = (payload: unknown) => {
  for (const win of getAllBrowserWindows()) {
    try {
      win.webContents.send('tasks:push', payload);
    } catch (error) {
      proactiveTaskLogger.event({
        level: 'warn',
        event: 'task.push',
        outcome: 'degraded',
        error,
        message: 'Failed to push proactive task event to renderer.',
      });
    }
  }
};

const showDesktopNotification = (params: { title: string; body: string }) => {
  try {
    if (!app.isReady()) return;
    if (!Notification.isSupported()) return;
    new Notification({
      title: params.title,
      body: params.body,
    }).show();
  } catch (error) {
    proactiveTaskLogger.event({
      level: 'warn',
      event: 'task.notification',
      outcome: 'degraded',
      error,
      message: 'Desktop notification failed.',
    });
  }
};

const ensureTaskThread = async (task: {
  id: string;
  name: string;
  model: string;
  provider_id?: string | null;
  thread_id?: string | null;
  prompt: string;
  schedule_type?: string;
  interval_minutes: number;
  cron_expression?: string | null;
  schedule_timezone?: string | null;
  tool_mode: ProactiveTask['tool_mode'];
  tools?: string | null;
}): Promise<string> => {
  const existingThreadId =
    typeof task.thread_id === 'string' && task.thread_id.trim() ? task.thread_id.trim() : '';
  if (existingThreadId) {
    const existing = chatService.getThread(existingThreadId);
    if (existing) return existingThreadId;
  }

  const createdThread = chatService.createThread({
    title: `Task: ${task.name}`,
    model: task.model || null,
    metadata: JSON.stringify({ source: 'proactive-task', taskId: task.id }),
  });

  if (!createdThread?.id) {
    throw new Error('Failed to create task thread');
  }

  const threadId = createdThread.id;

  // Persist thread id back to the task so future runs push into the same place.
  tasksDb.updateProactiveTask(task.id, { thread_id: threadId });

  // Write a "pinned" intro message so the thread explains what it is.
  const introText = [
    `### ⏰ Proactive Task Created`,
    `**Name:** ${task.name}`,
    `**Schedule:** ${formatTaskSchedule(task)}`,
    `**Tool Strategy:** ${formatTaskToolStrategy(task)}`,
    '',
    '**Prompt:**',
    task.prompt,
  ].join('\n');

  const introUiMessage = {
    id: createPrefixedId('msg'),
    role: 'assistant',
    parts: [{ type: 'text', text: introText }],
  };

  chatService.createMessage({
    id: introUiMessage.id,
    thread_id: threadId,
    parent_id: null,
    depth: 0,
    message: JSON.stringify(introUiMessage),
    timestamp: toIsoNow(),
    metadata: JSON.stringify({
      format: 'ai-ui-message-v1',
      source: 'proactive-task',
      taskId: task.id,
      kind: 'intro',
    }),
  });

  return threadId;
};

export const runProactiveTask = async (
  taskId: string,
  options?: { reason?: 'schedule' | 'manual' }
) => {
  const task = tasksDb.getProactiveTask(taskId);
  if (!task) return { success: false, error: 'Task not found' };
  if (!task.enabled && options?.reason !== 'manual') {
    return { success: false, error: 'Task is disabled' };
  }
  if (taskInFlight.has(taskId)) {
    return { success: false, error: 'Task already running' };
  }

  taskInFlight.add(taskId);
  const startedAt = toIsoNow();
  let threadId: string | null = null;
  tasksDb.updateProactiveTask(taskId, {
    last_status: 'running',
    last_error: null,
  });

  try {
    threadId = await ensureTaskThread({
      id: task.id,
      name: task.name,
      model: task.model,
      provider_id: task.provider_id ?? null,
      thread_id: task.thread_id ?? null,
      prompt: task.prompt,
      schedule_type: task.schedule_type,
      interval_minutes: task.interval_minutes,
      cron_expression: task.cron_expression ?? null,
      schedule_timezone: task.schedule_timezone ?? null,
      tool_mode: task.tool_mode,
      tools: task.tools ?? null,
    });

    const toolMode = inferProactiveTaskToolMode(task);
    const selectedTools = filterSafeProactiveTaskTools(parseProactiveTaskTools(task.tools));

    const result = await chatService.send({
      providerType: task.provider_type,
      providerId: task.provider_id ?? undefined,
      model: task.model,
      messages: [
        { role: 'system', content: PROACTIVE_TASK_AGENT_SYSTEM_PROMPT },
        {
          role: 'user',
          content: buildProactiveTaskPrompt(task, {
            startedAt,
            reason: options?.reason || 'schedule',
          }),
        },
      ],
      ...(toolMode === 'manual'
        ? { tools: selectedTools }
        : toolMode === 'disabled'
          ? { tools: [] }
          : {}),
      threadId,
      runConfig: {
        kind: 'proactive-task',
        metadata: {
          source: 'proactive-task',
          taskId: task.id,
          reason: options?.reason || 'schedule',
        },
      },
    });

    const nextRunAt = computeNextRunAt(task, startedAt);

    if (!result?.success) {
      const errorText = result?.error || 'Unknown error';
      tasksDb.updateProactiveTask(taskId, {
        last_run_at: startedAt,
        next_run_at: nextRunAt,
        last_status: 'error',
        last_error: errorText,
        last_output: null,
      });

      const errorMessageText = [
        `### ⏰ ${task.name} (Failed)`,
        `Run: ${new Date(startedAt).toLocaleString()}`,
        '',
        '```',
        errorText,
        '```',
      ].join('\n');

      const uiMessage = {
        id: createPrefixedId('msg'),
        role: 'assistant',
        parts: [{ type: 'text', text: errorMessageText }],
      };

      chatService.createMessage({
        id: uiMessage.id,
        thread_id: threadId,
        parent_id: null,
        depth: 0,
        message: JSON.stringify(uiMessage),
        timestamp: startedAt,
        metadata: JSON.stringify({
          format: 'ai-ui-message-v1',
          source: 'proactive-task',
          taskId: task.id,
          kind: 'error',
          reason: options?.reason || 'schedule',
        }),
      });

      chatThreadDb.touchChatThread(threadId);

      if (task.notify) {
        showDesktopNotification({
          title: `Task failed: ${task.name}`,
          body: errorText.slice(0, 180),
        });
      }

      companionService.pushTaskNudge({
        kind: 'task-error',
        taskName: task.name,
      });

      sendPushEventToRenderers({
        type: 'task-result',
        taskId: task.id,
        threadId,
        status: 'error',
        runAt: startedAt,
        message: uiMessage,
      });

      return { success: false, error: errorText };
    }

    const outputText = typeof result.text === 'string' ? result.text : '';
    const messageText = [
      `### ⏰ ${task.name}`,
      `Run: ${new Date(startedAt).toLocaleString()}`,
      '',
      outputText.trim() ? outputText : '_No output._',
    ].join('\n');

    const bridgeDelivery = await deliverBridgeThreadMessage({
      threadId,
      text: messageText,
    });

    if (bridgeDelivery.handled && !bridgeDelivery.delivered) {
      const deliveryError = `Failed to deliver ${bridgeDelivery.source || 'bridge'} message: ${
        bridgeDelivery.error || 'Unknown error'
      }`;

      tasksDb.updateProactiveTask(taskId, {
        last_run_at: startedAt,
        next_run_at: nextRunAt,
        last_status: 'error',
        last_output: outputText,
        last_error: deliveryError,
      });

      const failedDeliveryText = [
        `### ⏰ ${task.name} (Delivery Failed)`,
        `Run: ${new Date(startedAt).toLocaleString()}`,
        '',
        'Generated output:',
        outputText.trim() ? outputText : '_No output._',
        '',
        'Error:',
        '```',
        deliveryError,
        '```',
      ].join('\n');

      const failedDeliveryMessage = {
        id: createPrefixedId('msg'),
        role: 'assistant',
        parts: [{ type: 'text', text: failedDeliveryText }],
      };

      chatService.createMessage({
        id: failedDeliveryMessage.id,
        thread_id: threadId,
        parent_id: null,
        depth: 0,
        message: JSON.stringify(failedDeliveryMessage),
        timestamp: startedAt,
        metadata: JSON.stringify({
          format: 'ai-ui-message-v1',
          source: 'proactive-task',
          taskId: task.id,
          kind: 'error',
          stage: 'bridge-delivery',
          reason: options?.reason || 'schedule',
        }),
      });

      chatThreadDb.touchChatThread(threadId);

      if (task.notify) {
        showDesktopNotification({
          title: `Task failed: ${task.name}`,
          body: deliveryError.slice(0, 180),
        });
      }

      companionService.pushTaskNudge({
        kind: 'task-error',
        taskName: task.name,
      });

      sendPushEventToRenderers({
        type: 'task-result',
        taskId: task.id,
        threadId,
        status: 'error',
        runAt: startedAt,
        message: failedDeliveryMessage,
      });

      return { success: false, error: deliveryError };
    }

    tasksDb.updateProactiveTask(taskId, {
      last_run_at: startedAt,
      next_run_at: nextRunAt,
      last_status: 'success',
      last_output: outputText,
      last_error: null,
    });

    const uiMessage = {
      id: createPrefixedId('msg'),
      role: 'assistant',
      parts: [{ type: 'text', text: messageText }],
    };

    chatService.createMessage({
      id: uiMessage.id,
      thread_id: threadId,
      parent_id: null,
      depth: 0,
      message: JSON.stringify(uiMessage),
      timestamp: startedAt,
      metadata: JSON.stringify({
        format: 'ai-ui-message-v1',
        source: 'proactive-task',
        taskId: task.id,
        kind: 'success',
        reason: options?.reason || 'schedule',
      }),
    });

    chatThreadDb.touchChatThread(threadId);

    if (task.notify) {
      showDesktopNotification({
        title: `Task finished: ${task.name}`,
        body: (outputText || '').trim().slice(0, 180) || 'Completed',
      });
    }

    companionService.pushTaskNudge({
      kind: 'task-success',
      taskName: task.name,
    });

    sendPushEventToRenderers({
      type: 'task-result',
      taskId: task.id,
      threadId,
      status: 'success',
      runAt: startedAt,
      message: uiMessage,
    });

    return { success: true };
  } catch (error) {
    const errorText = getErrorMessage(error);
    const nextRunAt = computeNextRunAt(task, startedAt);
    tasksDb.updateProactiveTask(taskId, {
      last_run_at: startedAt,
      next_run_at: nextRunAt,
      last_status: 'error',
      last_error: errorText,
    });
    companionService.pushTaskNudge({
      kind: 'task-error',
      taskName: task.name,
    });
    return { success: false, error: errorText };
  } finally {
    taskInFlight.delete(taskId);
  }
};

const tick = async () => {
  if (tickInFlight) return;
  tickInFlight = true;
  try {
    const due = tasksDb.listDueProactiveTasks(toIsoNow());
    for (const task of due) {
      if (!task.enabled) continue;
      // Avoid overlap between scheduler ticks.
      if (taskInFlight.has(task.id)) continue;
      await runProactiveTask(task.id, { reason: 'schedule' });
    }
  } catch (error) {
    proactiveTaskLogger.event({
      level: 'warn',
      event: 'task.scheduler.tick',
      outcome: 'failed',
      error,
    });
  } finally {
    tickInFlight = false;
  }
};

export const startProactiveTaskScheduler = () => {
  if (schedulerTimer) return;
  schedulerTimer = setInterval(() => {
    void tick();
  }, SCHEDULER_TICK_MS);
  void tick();
};

export const stopProactiveTaskScheduler = () => {
  if (!schedulerTimer) return;
  clearInterval(schedulerTimer);
  schedulerTimer = null;
};
