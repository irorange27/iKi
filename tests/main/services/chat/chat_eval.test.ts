import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/core/db/agent_runs', () => ({
  getAgentRunTrace: vi.fn(),
}));

vi.mock('../../../../src/core/db/agent_eval', () => ({
  createEvalLabel: vi.fn(),
  listEvalLabelsByRun: vi.fn(),
  deleteEvalLabel: vi.fn(),
}));

vi.mock('electron', () => ({
  dialog: {
    showSaveDialog: vi.fn(),
  },
}));

vi.mock('node:fs', () => ({
  default: {
    writeFileSync: vi.fn(),
  },
}));

import { createChatEval } from '../../../../src/main/services/chat/eval';
import * as agentRunDb from '../../../../src/core/db/agent_runs';
import * as agentEvalDb from '../../../../src/core/db/agent_eval';

const getAgentRunTraceMock = vi.mocked(agentRunDb.getAgentRunTrace);
const listEvalLabelsByRunMock = vi.mocked(agentEvalDb.listEvalLabelsByRun);

function makeStep(overrides: Record<string, unknown> = {}) {
  return {
    id: overrides.id as string ?? 'step_1',
    runId: 'run_1',
    stepIndex: (overrides.stepIndex as number) ?? 0,
    type: (overrides.type as string) ?? 'model',
    status: (overrides.status as string) ?? 'completed',
    summary: (overrides.summary as string) ?? 'model response',
    input: null,
    output: null,
    startedAt: '2026-01-01T00:00:00.000Z',
    finishedAt: '2026-01-01T00:00:01.000Z',
  };
}

function makeTrace(steps: ReturnType<typeof makeStep>[] = [makeStep()]) {
  return {
    run: {
      id: 'run_1',
      kind: 'chat-turn',
      status: 'completed',
      threadId: 'thread_1',
      parentRunId: null,
      rootRunId: 'run_1',
      providerType: 'openai',
      providerId: null,
      model: 'gpt-4',
      systemPrompt: '',
      enabledTools: [],
      availableSkillIds: [],
      input: {},
      working: { modelMessages: [], accumulatedText: '', pendingApprovalIds: [], lastStepIndex: 0 },
      output: null,
      error: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    steps,
    latestCheckpoint: null,
    children: [],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('chat_eval service', () => {
  const eval_ = createChatEval();

  describe('addLabel', () => {
    it('adds a label via db layer', () => {
      vi.mocked(agentEvalDb.createEvalLabel).mockReturnValue({
        id: 'eval_1',
        runId: 'run_1',
        stepId: 'step_1',
        label: 'correct',
        note: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      });

      const label = eval_.addLabel({ runId: 'run_1', stepId: 'step_1', label: 'correct' });
      expect(label.label).toBe('correct');
    });
  });

  describe('listLabels', () => {
    it('returns labels for a run', () => {
      listEvalLabelsByRunMock.mockReturnValue([]);
      expect(eval_.listLabels('run_1')).toEqual([]);
    });
  });

  describe('deleteLabel', () => {
    it('deletes a label', () => {
      vi.mocked(agentEvalDb.deleteEvalLabel).mockReturnValue({ success: true });
      expect(eval_.deleteLabel('eval_1')).toEqual({ success: true });
    });
  });

  describe('compareRuns', () => {
    it('returns null if baseline trace is missing', () => {
      getAgentRunTraceMock.mockReturnValueOnce(null);
      getAgentRunTraceMock.mockReturnValueOnce(makeTrace());
      expect(eval_.compareRuns('run_a', 'run_b')).toBeNull();
    });

    it('returns null if test trace is missing', () => {
      getAgentRunTraceMock.mockReturnValueOnce(makeTrace());
      getAgentRunTraceMock.mockReturnValueOnce(null);
      expect(eval_.compareRuns('run_a', 'run_b')).toBeNull();
    });

    it('returns comparison with all steps matching', () => {
      const traceA = makeTrace([makeStep({ id: 's1', stepIndex: 0, type: 'model' })]);
      const traceB = makeTrace([makeStep({ id: 's2', stepIndex: 0, type: 'model' })]);
      getAgentRunTraceMock.mockReturnValueOnce(traceA);
      getAgentRunTraceMock.mockReturnValueOnce(traceB);
      listEvalLabelsByRunMock.mockReturnValue([]);

      const comparison = eval_.compareRuns('run_a', 'run_b');
      expect(comparison).not.toBeNull();
      expect(comparison!.totalStepsA).toBe(1);
      expect(comparison!.totalStepsB).toBe(1);
      expect(comparison!.stepComparison[0].match).toBe(true);
    });

    it('detects mismatched step types', () => {
      const traceA = makeTrace([makeStep({ id: 's1', stepIndex: 0, type: 'model' })]);
      const traceB = makeTrace([makeStep({ id: 's2', stepIndex: 0, type: 'tool-call' })]);
      getAgentRunTraceMock.mockReturnValueOnce(traceA);
      getAgentRunTraceMock.mockReturnValueOnce(traceB);
      listEvalLabelsByRunMock.mockReturnValue([]);

      const comparison = eval_.compareRuns('run_a', 'run_b');
      expect(comparison!.stepComparison[0].match).toBe(false);
    });

    it('handles different step counts', () => {
      const traceA = makeTrace([
        makeStep({ id: 's1', stepIndex: 0 }),
        makeStep({ id: 's2', stepIndex: 1 }),
      ]);
      const traceB = makeTrace([makeStep({ id: 's3', stepIndex: 0 })]);
      getAgentRunTraceMock.mockReturnValueOnce(traceA);
      getAgentRunTraceMock.mockReturnValueOnce(traceB);
      listEvalLabelsByRunMock.mockReturnValue([]);

      const comparison = eval_.compareRuns('run_a', 'run_b');
      expect(comparison!.totalStepsA).toBe(2);
      expect(comparison!.totalStepsB).toBe(1);
      expect(comparison!.stepComparison[0].match).toBe(true);
      expect(comparison!.stepComparison[1].comparisonStep).toBeNull();
    });

    it('attaches labels to baseline steps', () => {
      const traceA = makeTrace([makeStep({ id: 's1', stepIndex: 0 })]);
      const traceB = makeTrace([makeStep({ id: 's2', stepIndex: 0 })]);
      getAgentRunTraceMock.mockReturnValueOnce(traceA);
      getAgentRunTraceMock.mockReturnValueOnce(traceB);
      listEvalLabelsByRunMock.mockReturnValue([
        {
          id: 'eval_1',
          runId: 'run_a',
          stepId: 's1',
          label: 'correct',
          note: null,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ]);

      const comparison = eval_.compareRuns('run_a', 'run_b');
      expect(comparison!.stepComparison[0].labels).toHaveLength(1);
    });
  });

  describe('assessRegression', () => {
    it('returns pending when no labels exist', () => {
      const trace = makeTrace();
      getAgentRunTraceMock.mockReturnValue(trace);
      getAgentRunTraceMock.mockReturnValue(trace);
      listEvalLabelsByRunMock.mockReturnValue([]);

      const assessment = eval_.assessRegression('run_a', 'run_b');
      expect(assessment!.status).toBe('pending');
    });

    it('returns pass when only correct labels exist', () => {
      const trace = makeTrace();
      getAgentRunTraceMock.mockReturnValue(trace);
      getAgentRunTraceMock.mockReturnValue(trace);
      listEvalLabelsByRunMock.mockReturnValue([
        { id: 'e1', runId: 'run_a', stepId: 's1', label: 'correct', note: null, createdAt: '', updatedAt: '' },
      ]);

      const assessment = eval_.assessRegression('run_a', 'run_b');
      expect(assessment!.status).toBe('pass');
    });

    it('returns fail when incorrect labels exist', () => {
      const trace = makeTrace();
      getAgentRunTraceMock.mockReturnValue(trace);
      getAgentRunTraceMock.mockReturnValue(trace);
      listEvalLabelsByRunMock.mockReturnValue([
        { id: 'e1', runId: 'run_a', stepId: 's1', label: 'incorrect', note: null, createdAt: '', updatedAt: '' },
      ]);

      const assessment = eval_.assessRegression('run_a', 'run_b');
      expect(assessment!.status).toBe('fail');
    });
  });
});
