import { Notification, app } from 'electron';

import { createLogger } from '@iki/backend/logger';
import {
  createProactiveTaskRunner,
  type ProactiveTaskRunner,
} from '@iki/backend/tasks/proactive_task_runner';
import { getAllBrowserWindows } from '../../utils/browser_windows';
import { chatService } from '../chat/service';
import { companionService } from '../companion/companion_service';

const proactiveTaskLogger = createLogger({ module: 'proactive_tasks' });

const SCHEDULER_TICK_MS = 30 * 1000;

let schedulerTimer: ReturnType<typeof setInterval> | undefined;

/**
 * Stage E: the execution business (prompt construction, run orchestration,
 * result persistence, delivery) lives in backend/tasks/proactive_task_runner.
 * This file is the desktop assembly: it supplies the Electron capabilities —
 * desktop notifications, renderer push, companion nudge — and the chat
 * service, and owns the scheduler clock.
 */
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

const runner: ProactiveTaskRunner = createProactiveTaskRunner({
  chat: chatService,
  host: {
    notify: showDesktopNotification,
    pushTaskEvent: sendPushEventToRenderers,
    pushTaskNudge: nudge => companionService.pushTaskNudge(nudge),
  },
});

export const runProactiveTask = runner.runProactiveTask;

const tick = async () => {
  await runner.tick();
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
