import { cleanupOldAgentRuns, recoverStuckRunsOnStartup } from '@iki/core/db/agent_runs';
import { createLogger } from '@iki/core/logger';
import { startProactiveTaskScheduler, stopProactiveTaskScheduler } from '../tasks/proactive_tasks';
import { startAwaiterScheduler, stopAwaiterScheduler } from '../awaiters/awaiters';
import { startClipboardMonitor, stopClipboardMonitor } from '../context/clipboard_monitor';

const runtimeLogger = createLogger({ module: 'background_runtime' });

const RUN_TTL_CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // every hour
const RUN_TTL_MAX_AGE_DAYS = 90;

let started = false;
let cleanupInterval: ReturnType<typeof setInterval> | undefined;

const runTtlCleanup = () => {
  try {
    const result = cleanupOldAgentRuns(RUN_TTL_MAX_AGE_DAYS);
    if (result.deletedRuns > 0) {
      runtimeLogger.event({
        level: 'info',
        event: 'runtime.ttl.cleanup',
        outcome: 'succeeded',
        message: `Cleaned up ${result.deletedRuns} old terminal runs older than ${RUN_TTL_MAX_AGE_DAYS} days`,
        data: { deletedRuns: result.deletedRuns, maxAgeDays: RUN_TTL_MAX_AGE_DAYS },
      });
    }
  } catch (error) {
    runtimeLogger.event({
      level: 'error',
      event: 'runtime.ttl.cleanup',
      outcome: 'failed',
      message: 'Failed to clean up old terminal runs',
      error,
    });
  }
};

export const startBackgroundRuntime = () => {
  if (started) return;
  started = true;

  try {
    const recovery = recoverStuckRunsOnStartup();
    if (recovery.totalRuns > 0) {
      runtimeLogger.event({
        level: 'warn',
        event: 'runtime.startup.recovery',
        outcome: 'succeeded',
        message: `Recovered ${recovery.totalRuns} stuck runs from previous session (${recovery.failedRuns} running, ${recovery.blockedRuns} blocked — all marked failed)`,
        data: {
          failedRuns: recovery.failedRuns,
          blockedRuns: recovery.blockedRuns,
          totalRuns: recovery.totalRuns,
        },
      });
    }
  } catch (error) {
    runtimeLogger.event({
      level: 'error',
      event: 'runtime.startup.recovery',
      outcome: 'failed',
      message: 'Failed to recover stuck runs on startup',
      error,
    });
  }

  startProactiveTaskScheduler();
  startAwaiterScheduler();
  startClipboardMonitor();

  runTtlCleanup();
  cleanupInterval = setInterval(runTtlCleanup, RUN_TTL_CLEANUP_INTERVAL_MS);
};

export const stopBackgroundRuntime = () => {
  if (!started) return;
  started = false;
  stopProactiveTaskScheduler();
  stopAwaiterScheduler();
  stopClipboardMonitor();
  if (cleanupInterval !== undefined) {
    clearInterval(cleanupInterval);
    cleanupInterval = undefined;
  }
};
