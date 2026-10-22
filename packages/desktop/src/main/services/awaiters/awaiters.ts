import { Notification, app } from 'electron';

import { createLogger } from '@iki/backend/logger';
import {
  createAwaiterRunner,
  type AwaiterRunner,
} from '@iki/backend/awaiters/awaiter_runner';
import { getAllBrowserWindows } from '../../utils/browser_windows';
import type { ChatStreamTarget } from '@iki/backend/thread_session';
import { chatService } from '../chat/service';

const awaiterLogger = createLogger({ module: 'awaiters' });

const SCHEDULER_TICK_MS = 30_000;

let schedulerTimer: NodeJS.Timeout | null = null;

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

// A wake is a turn like any other: it rides the streaming transport and throws
// its chunks away, because the transcript is rebuilt from the session log.
const AWAITER_TARGET: ChatStreamTarget = { id: -1, send: () => undefined };

const runner: AwaiterRunner = createAwaiterRunner({
  chat: {
    getThread: chatService.getThread,
    createMessage: chatService.createMessage,
    stream: options => chatService.stream(AWAITER_TARGET, options),
  },
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
