import { startPresenceRuntime, stopPresenceRuntime } from '../presence/presence_runtime';
import { startProactiveTaskScheduler, stopProactiveTaskScheduler } from '../tasks/proactive_tasks';

let started = false;

export const startBackgroundRuntime = () => {
  if (started) return;
  started = true;
  startProactiveTaskScheduler();
  startPresenceRuntime();
};

export const stopBackgroundRuntime = () => {
  if (!started) return;
  started = false;
  stopPresenceRuntime();
  stopProactiveTaskScheduler();
};
