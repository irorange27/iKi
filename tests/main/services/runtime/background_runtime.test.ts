import { afterEach, describe, expect, it, vi } from 'vitest';

const { startClipboardMonitorMock, stopClipboardMonitorMock } = vi.hoisted(() => ({
  startClipboardMonitorMock: vi.fn(),
  stopClipboardMonitorMock: vi.fn(),
}));

vi.mock('@iki/backend/db/agent_runs', () => ({
  cleanupOldAgentRuns: vi.fn(() => ({ deletedRuns: 0 })),
}));

vi.mock('@iki/backend/thread_session/run_tracker', () => ({
  recoverStuckRunsOnStartup: vi.fn(() => ({
    totalRuns: 0,
    failedRuns: 0,
    blockedRuns: 0,
    expiredApprovals: 0,
    interruptedToolParts: 0,
  })),
}));

vi.mock('@iki/backend/logger', () => ({
  createLogger: () => ({ event: vi.fn() }),
}));

vi.mock('../../../../packages/desktop/src/main/services/tasks/proactive_tasks', () => ({
  startProactiveTaskScheduler: vi.fn(),
  stopProactiveTaskScheduler: vi.fn(),
}));

vi.mock('../../../../packages/desktop/src/main/services/awaiters/awaiters', () => ({
  startAwaiterScheduler: vi.fn(),
  stopAwaiterScheduler: vi.fn(),
}));

vi.mock('../../../../packages/desktop/src/main/services/context/clipboard_monitor', () => ({
  startClipboardMonitor: startClipboardMonitorMock,
  stopClipboardMonitor: stopClipboardMonitorMock,
}));

import {
  startBackgroundRuntime,
  stopBackgroundRuntime,
} from '../../../../packages/desktop/src/main/services/runtime/background_runtime';

afterEach(() => {
  stopBackgroundRuntime();
  vi.clearAllMocks();
});

describe('background runtime', () => {
  it('does not collect clipboard contents in the background', () => {
    startBackgroundRuntime();

    expect(startClipboardMonitorMock).not.toHaveBeenCalled();
    expect(stopClipboardMonitorMock).not.toHaveBeenCalled();
  });
});
