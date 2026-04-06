import { startProactiveTaskScheduler, stopProactiveTaskScheduler } from '../tasks/proactive_tasks';

let started = false;

export const startBackgroundRuntime = () => {
  if (started) return;
  started = true;
  startProactiveTaskScheduler();
};

export const stopBackgroundRuntime = () => {
  if (!started) return;
  started = false;
  stopProactiveTaskScheduler();
};
