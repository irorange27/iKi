import * as tasksDb from '@iki/backend/db/tasks';
import type { ChatTurnOptions } from '../turn_prep/turn_preparer';
import * as chatThreadDb from '@iki/backend/db/chat_thread';
import { createLogger } from '@iki/backend/logger';
import { clampIntervalMinutes, computeNextRunAt } from '@iki/backend/tasks/task_schedule';
import { deliverBridgeThreadMessage } from '@iki/backend/bridge_dispatch';
import {
  filterSafeProactiveTaskTools,
  inferProactiveTaskToolMode,
  parseProactiveTaskTools,
  type ProactiveTask,
} from '@iki/backend/types/tasks';
import { createPrefixedId } from '@iki/backend/utils/id';
import { getErrorMessage } from '@iki/backend/utils/errors';
import { toIsoNow } from '@iki/backend/utils/text';

const logger = createLogger({ module: 'proactive_task_runner' });

/**
 * The proactive-task execution business: prompt construction, the run
 * orchestration, result persistence and delivery. This module owns WHEN a
 * task last ran, what it produced and WHEN it next runs — the host shell
 * contributes only the clock, notifications and transport via the injected
 * port (stage E: the business used to live in desktop main).
 */

/** Host capabilities the runner needs — no Electron types cross this line. */
export type TaskRunnerHostPort = {
  /** Desktop notification (no-op hosts skip it). */
  notify?: (params: { title: string; body: string }) => void;
  /** Push a task event to subscribed UIs. */
  pushTaskEvent?: (payload: unknown) => void;
  /** Nudge the companion surface. */
  pushTaskNudge?: (nudge: { kind: 'task-error' | 'task-success'; taskName: string }) => void;
};

/** The chat-service surface the runner drives. */
export type TaskRunnerChatPort = {
  getThread: (threadId: string) => { id: string } | null;
  createThread: (input: {
    title: string;
    model: string | null;
    metadata?: string;
  }) => { id: string } | null;
  createMessage: (input: unknown) => unknown;
  send: (options: ChatTurnOptions) => Promise<{
    success: boolean;
    error?: string;
    text?: string;
  }>;
};

export type ProactiveTaskRunnerDeps = {
  chat: TaskRunnerChatPort;
  host: TaskRunnerHostPort;
};

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

const formatTaskToolStrategy = (
  task: Pick<ProactiveTask, 'tools' | 'tool_mode'>
): string => {
  const toolMode = inferProactiveTaskToolMode(task);
  if (toolMode === 'auto')
    return 'Agent decides automatically using the safe built-in tool catalog.';
  if (toolMode === 'disabled') return 'Tools disabled; run as plain model reasoning only.';
  const tools = filterSafeProactiveTaskTools(parseProactiveTaskTools(task.tools));
  return tools.length > 0
    ? `Manual safe tools: ${tools.join(', ')}`
    : 'Manual tool mode configured, but no safe tools remain enabled.';
};

const PROACTIVE_TASK_AGENT_SYSTEM_PROMPT = [
  'You are executing a scheduled proactive task for the user.',
  'Act autonomously and complete the task without asking the user follow-up questions.',
  'When the task depends on current information, proactively use the available tools to verify freshness instead of relying on stale model knowledge.',
  'Prefer concise, high-signal updates that emphasize material changes, concrete dates, and actionable conclusions.',
  'Avoid repeating unchanged background from prior runs. If nothing important changed, say so plainly.',
  'When you cite current information, include source links or source names when practical.',
].join('\n');

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

const ensureTaskThread = async (
  chat: TaskRunnerChatPort,
  task: Pick<
    ProactiveTask,
    | 'id'
    | 'name'
    | 'model'
    | 'thread_id'
    | 'prompt'
    | 'schedule_type'
    | 'interval_minutes'
    | 'cron_expression'
    | 'schedule_timezone'
    | 'tool_mode'
    | 'tools'
  >
): Promise<string> => {
  const existingThreadId =
    typeof task.thread_id === 'string' && task.thread_id.trim() ? task.thread_id.trim() : '';
  if (existingThreadId) {
    const existing = chat.getThread(existingThreadId);
    if (existing) return existingThreadId;
  }

  const createdThread = chat.createThread({
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

  chat.createMessage({
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

export const createProactiveTaskRunner = (deps: ProactiveTaskRunnerDeps) => {
  const { chat, host } = deps;
  const taskInFlight = new Set<string>();

  const notify = (params: { title: string; body: string }) => host.notify?.(params);
  const pushTaskEvent = (payload: unknown) => host.pushTaskEvent?.(payload);
  const pushTaskNudge = (nudge: { kind: 'task-error' | 'task-success'; taskName: string }) =>
    host.pushTaskNudge?.(nudge);

  const runProactiveTask = async (
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
      threadId = await ensureTaskThread(chat, task);

      const toolMode = inferProactiveTaskToolMode(task);
      const selectedTools = filterSafeProactiveTaskTools(parseProactiveTaskTools(task.tools));

      const result = (await chat.send({
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
      }));

      const nextRunAt = computeNextRunAt(task, startedAt);

      if (result.success === false) {
        const errorText = result.error || 'Unknown error';
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

        chat.createMessage({
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
          notify({
            title: `Task failed: ${task.name}`,
            body: errorText.slice(0, 180),
          });
        }

        pushTaskNudge({ kind: 'task-error', taskName: task.name });

        pushTaskEvent({
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

        chat.createMessage({
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
          notify({
            title: `Task failed: ${task.name}`,
            body: deliveryError.slice(0, 180),
          });
        }

        pushTaskNudge({ kind: 'task-error', taskName: task.name });

        pushTaskEvent({
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

      chat.createMessage({
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
        notify({
          title: `Task finished: ${task.name}`,
          body: (outputText || '').trim().slice(0, 180) || 'Completed',
        });
      }

      pushTaskNudge({ kind: 'task-success', taskName: task.name });

      pushTaskEvent({
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
      pushTaskNudge({ kind: 'task-error', taskName: task.name });
      return { success: false, error: errorText };
    } finally {
      taskInFlight.delete(taskId);
    }
  };

  /** One scheduler pass: run everything due. The clock stays with the host. */
  const tick = async (): Promise<void> => {
    const due = tasksDb.listDueProactiveTasks(toIsoNow());
    for (const task of due) {
      if (!task.enabled) continue;
      // Avoid overlap between scheduler ticks.
      if (taskInFlight.has(task.id)) continue;
      await runProactiveTask(task.id, { reason: 'schedule' });
    }
  };

  let tickInFlight = false;
  /** Tick with overlap protection — the host clock calls this. */
  const guardedTick = async (): Promise<void> => {
    if (tickInFlight) return;
    tickInFlight = true;
    try {
      await tick();
    } catch (error) {
      logger.event({
        level: 'warn',
        event: 'task.scheduler.tick',
        outcome: 'failed',
        error,
      });
    } finally {
      tickInFlight = false;
    }
  };

  return { runProactiveTask, tick: guardedTick };
};

export type ProactiveTaskRunner = ReturnType<typeof createProactiveTaskRunner>;
