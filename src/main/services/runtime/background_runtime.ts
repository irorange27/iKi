import { startLifeRuntime, stopLifeRuntime } from '../life/life_runtime';
import { startProactiveTaskScheduler, stopProactiveTaskScheduler } from '../tasks/proactive_tasks';

let started = false;

export const startBackgroundRuntime = () => {
  if (started) return;
  started = true;
  startProactiveTaskScheduler();
  startLifeRuntime();
};

export const stopBackgroundRuntime = () => {
  if (!started) return;
  started = false;
  stopLifeRuntime();
  stopProactiveTaskScheduler();
};
