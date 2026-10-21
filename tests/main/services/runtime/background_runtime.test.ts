import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';

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

import {
  startBackgroundRuntime,
  stopBackgroundRuntime,
} from '../../../../packages/desktop/src/main/services/runtime/background_runtime';

const RUNTIME_SOURCE = new URL(
  '../../../../packages/desktop/src/main/services/runtime/background_runtime.ts',
  import.meta.url
);

afterEach(() => {
  stopBackgroundRuntime();
  vi.clearAllMocks();
});

describe('background runtime', () => {
  it('starts and stops without throwing', () => {
    expect(() => startBackgroundRuntime()).not.toThrow();
  });

  it('does not collect clipboard contents in the background', () => {
    const source = readFileSync(RUNTIME_SOURCE, 'utf8');
    expect(source).not.toMatch(/clipboard/i);
  });
});
