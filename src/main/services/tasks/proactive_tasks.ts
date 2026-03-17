import { BrowserWindow, Notification, app } from 'electron';

import * as tasksDb from '../../../core/db/tasks';
import * as chatThreadDb from '../../../core/db/chat_thread';
import { chatService } from '../chat/chat_service';
import { getErrorMessage } from '../../utils/errors';

const SCHEDULER_TICK_MS = 30_000;
const MIN_INTERVAL_MINUTES = 1;
const MAX_INTERVAL_MINUTES = 60 * 24 * 7; // 7 days

let schedulerTimer: NodeJS.Timeout | null = null;
let tickInFlight = false;
const taskInFlight = new Set<string>();

const nowIso = () => new Date().toISOString();

const clampIntervalMinutes = (value: unknown): number => {
  const asNumber = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(asNumber)) return 60;
  return Math.min(MAX_INTERVAL_MINUTES, Math.max(MIN_INTERVAL_MINUTES, Math.trunc(asNumber)));
};

const addMinutes = (baseIso: string, minutes: number): string => {
  const base = new Date(baseIso);
  if (Number.isNaN(base.getTime())) return nowIso();
  base.setMinutes(base.getMinutes() + minutes);
  return base.toISOString();
};

const computeNextRunAt = (task: { schedule_type?: string; interval_minutes?: number }, fromIso: string) => {
  // For now we only support a simple interval schedule.
  const minutes = clampIntervalMinutes(task.interval_minutes);
  return addMinutes(fromIso, minutes);
};

const safeParseTools = (raw: unknown): string[] => {
  if (Array.isArray(raw)) {
    return raw.filter((t): t is string => typeof t === 'string' && t.trim().length > 0);
  }
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.filter((t): t is string => typeof t === 'string' && t.trim().length > 0);
      }
    } catch {
      return [];
    }
  }
  return [];
};

const SAFE_PROACTIVE_TOOLS = new Set<string>(['web', 'fetch', 'read_file', 'list_dir']);

const filterSafeTools = (tools: string[]): string[] =>
  tools.filter(toolName => SAFE_PROACTIVE_TOOLS.has(toolName));

const createRuntimeId = (prefix: string) =>
  `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

const sendPushEventToRenderers = (payload: unknown) => {
  for (const win of BrowserWindow.getAllWindows()) {
    try {
      win.webContents.send('tasks:push', payload);
    } catch (error) {
      console.warn('[Tasks] failed to send push event:', error);
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
    console.warn('[Tasks] notification failed:', error);
  }
};

const ensureTaskThread = async (task: {
  id: string;
  name: string;
  model: string;
  thread_id?: string | null;
  prompt: string;
  interval_minutes: number;
}): Promise<string> => {
  const existingThreadId = typeof task.thread_id === 'string' && task.thread_id.trim() ? task.thread_id.trim() : '';
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
    `**Schedule:** every ${clampIntervalMinutes(task.interval_minutes)} minute(s)`,
    '',
    '**Prompt:**',
    task.prompt,
  ].join('\n');

  const introUiMessage = {
    id: createRuntimeId('msg'),
    role: 'assistant',
    parts: [{ type: 'text', text: introText }],
  };

  chatService.createMessage({
    id: introUiMessage.id,
    thread_id: threadId,
    parent_id: null,
    depth: 0,
    message: JSON.stringify(introUiMessage),
    timestamp: nowIso(),
    metadata: JSON.stringify({ format: 'ai-ui-message-v1', source: 'proactive-task', taskId: task.id, kind: 'intro' }),
  });

  return threadId;
};

export const runProactiveTask = async (taskId: string, options?: { reason?: 'schedule' | 'manual' }) => {
  const task = tasksDb.getProactiveTask(taskId);
  if (!task) return { success: false, error: 'Task not found' };
  if (!task.enabled && options?.reason !== 'manual') {
    return { success: false, error: 'Task is disabled' };
  }
  if (taskInFlight.has(taskId)) {
    return { success: false, error: 'Task already running' };
  }

  taskInFlight.add(taskId);
  const startedAt = nowIso();
  tasksDb.updateProactiveTask(taskId, {
    last_status: 'running',
    last_error: null,
  });

  try {
    const threadId = await ensureTaskThread({
      id: task.id,
      name: task.name,
      model: task.model,
      thread_id: task.thread_id ?? null,
      prompt: task.prompt,
      interval_minutes: task.interval_minutes,
    });

    const selectedTools = filterSafeTools(safeParseTools(task.tools));

    const result = await chatService.send({
      providerType: task.provider_type,
      model: task.model,
      messages: [{ role: 'user', content: task.prompt }],
      ...(selectedTools.length > 0 ? { tools: selectedTools } : {}),
      threadId,
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
        id: createRuntimeId('msg'),
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

    tasksDb.updateProactiveTask(taskId, {
      last_run_at: startedAt,
      next_run_at: nextRunAt,
      last_status: 'success',
      last_output: outputText,
      last_error: null,
    });

    const messageText = [
      `### ⏰ ${task.name}`,
      `Run: ${new Date(startedAt).toLocaleString()}`,
      '',
      outputText.trim() ? outputText : '_No output._',
    ].join('\n');

    const uiMessage = {
      id: createRuntimeId('msg'),
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
    return { success: false, error: errorText };
  } finally {
    taskInFlight.delete(taskId);
  }
};

const tick = async () => {
  if (tickInFlight) return;
  tickInFlight = true;
  try {
    const due = tasksDb.listDueProactiveTasks(nowIso());
    for (const task of due) {
      if (!task.enabled) continue;
      // Avoid overlap between scheduler ticks.
      if (taskInFlight.has(task.id)) continue;
      await runProactiveTask(task.id, { reason: 'schedule' });
    }
  } catch (error) {
    console.warn('[Tasks] scheduler tick failed:', error);
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
