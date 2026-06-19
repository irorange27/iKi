import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@iki/core/context/agent_run_store', () => ({
  appendAgentRunStep: vi.fn(),
  createAgentRun: vi.fn(),
  createAgentRunCheckpoint: vi.fn(),
  getAgentRun: vi.fn(),
  updateAgentRun: vi.fn(),
}));

import * as agentRunDb from '@iki/core/context/agent_run_store';
import { createAgentRunTracker } from '@iki/core/agent/run_tracker';

const createAgentRunMock = vi.mocked(agentRunDb.createAgentRun);
const updateAgentRunMock = vi.mocked(agentRunDb.updateAgentRun);
const appendAgentRunStepMock = vi.mocked(agentRunDb.appendAgentRunStep);
const getAgentRunMock = vi.mocked(agentRunDb.getAgentRun);

const buildStoredRun = (overrides: Record<string, unknown> = {}) => ({
  id: 'run_child_1',
  kind: 'delegated-agent',
  status: 'running',
  threadId: 'thread_1',
  parentRunId: 'run_parent_1',
  rootRunId: 'run_root_1',
  providerType: 'openai',
  providerId: null,
  model: 'gpt-4o-mini',
  systemPrompt: 'system prompt',
  enabledTools: ['list_dir'],
  availableSkillIds: [],
  input: {
    prompt: 'Inspect files',
    metadata: { source: 'delegated-agent' },
  },
  working: {
    modelMessages: [],
    accumulatedText: '',
    pendingApprovalIds: [],
    lastStepIndex: 0,
  },
  output: null,
  error: null,
  createdAt: '2026-04-10T00:00:00.000Z',
  updatedAt: '2026-04-10T00:00:00.000Z',
  ...overrides,
});

describe('createAgentRunTracker', () => {
  let storedRun = buildStoredRun();

  beforeEach(() => {
    vi.clearAllMocks();
    storedRun = buildStoredRun();
    getAgentRunMock.mockImplementation(id =>
      id === 'run_parent_1'
        ? (buildStoredRun({
            id: 'run_parent_1',
            kind: 'chat-turn',
            parentRunId: null,
            rootRunId: 'run_root_1',
          }) as never)
        : null
    );
    createAgentRunMock.mockImplementation(input => {
      storedRun = {
        ...storedRun,
        ...input,
        createdAt: '2026-04-10T00:00:00.000Z',
        updatedAt: '2026-04-10T00:00:00.000Z',
      };
      return storedRun as never;
    });
    updateAgentRunMock.mockImplementation((_id, updates) => {
      storedRun = {
        ...storedRun,
        ...updates,
        working: updates.working ?? storedRun.working,
        output: updates.output === undefined ? storedRun.output : updates.output,
        error: updates.error === undefined ? storedRun.error : updates.error,
        updatedAt: '2026-04-10T00:00:01.000Z',
      };
      return storedRun as never;
    });
  });

  it('inherits root run id from the parent run and records generate-path tool calls', () => {
    const tracker = createAgentRunTracker({
      kind: 'delegated-agent',
      threadId: 'thread_1',
      parentRunId: 'run_parent_1',
      providerType: 'openai',
      model: 'gpt-4o-mini',
      systemPrompt: 'system prompt',
      enabledTools: ['list_dir'],
      availableSkillIds: [],
      input: {
        prompt: 'Inspect files',
        metadata: { source: 'delegated-agent' },
      },
      working: {
        modelMessages: [],
        accumulatedText: '',
        pendingApprovalIds: [],
        lastStepIndex: 0,
      },
    });

    expect(createAgentRunMock).toHaveBeenCalledWith(
      expect.objectContaining({
        parentRunId: 'run_parent_1',
        rootRunId: 'run_root_1',
      })
    );

    tracker.recordToolCalls([{ toolName: 'list_dir', args: { path: '.' } }]);

    expect(appendAgentRunStepMock).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: tracker.id,
        stepIndex: 1,
        type: 'tool-call',
        status: 'completed',
        input: {
          toolName: 'list_dir',
          args: { path: '.' },
        },
      })
    );
    expect(tracker.getRun().working.lastStepIndex).toBe(1);
  });
});
