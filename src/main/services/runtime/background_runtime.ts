import { startProactiveTaskScheduler, stopProactiveTaskScheduler } from '../tasks/proactive_tasks';
import { startAwaiterScheduler, stopAwaiterScheduler } from '../awaiters/awaiters';

let started = false;

export const startBackgroundRuntime = () => {
  if (started) return;
  started = true;
  startProactiveTaskScheduler();
  startAwaiterScheduler();
};

export const stopBackgroundRuntime = () => {
  if (!started) return;
  started = false;
  stopProactiveTaskScheduler();
  stopAwaiterScheduler();
};
