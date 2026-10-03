import { Notification, app } from 'electron';

import { createLogger } from '@iki/backend/logger';
import {
  createAwaiterRunner,
  type AwaiterRunner,
} from '@iki/backend/awaiters/awaiter_runner';
import { getAllBrowserWindows } from '../../utils/browser_windows';
import { chatService } from '../chat/service';

const awaiterLogger = createLogger({ module: 'awaiters' });

const SCHEDULER_TICK_MS = 30_000;

let schedulerTimer: NodeJS.Timeout | null = null;

/**
 * Stage E: the wake business (prompt construction, disposition transitions,
 * wake-event audit, delivery) lives in backend/awaiters/awaiter_runner. This
 * file is the desktop assembly: it supplies the Electron capabilities —
 * desktop notifications and renderer push — plus the chat service, and owns
 * the scheduler clock.
 */
const sendPushEventToRenderers = (payload: unknown) => {
  for (const win of getAllBrowserWindows()) {
    try {
      win.webContents.send('awaiters:push', payload);
    } catch (error) {
      awaiterLogger.event({
        level: 'warn',
        event: 'awaiter.push',
        outcome: 'degraded',
        error,
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
    awaiterLogger.event({
      level: 'warn',
      event: 'awaiter.notification',
      outcome: 'degraded',
      error,
    });
  }
};

const runner: AwaiterRunner = createAwaiterRunner({
  chat: chatService,
  host: {
    notify: showDesktopNotification,
    pushAwaiterEvent: sendPushEventToRenderers,
  },
});

export const runAwaiterWake = runner.runAwaiterWake;

const tick = async () => {
  await runner.tick();
};

export const startAwaiterScheduler = () => {
  if (schedulerTimer) return;
  schedulerTimer = setInterval(() => {
    void tick();
  }, SCHEDULER_TICK_MS);
  void tick();
};

export const stopAwaiterScheduler = () => {
  if (!schedulerTimer) return;
  clearInterval(schedulerTimer);
  schedulerTimer = null;
};
