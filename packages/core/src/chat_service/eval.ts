import * as agentRunDb from '@iki/core/db/agent_runs';
import * as agentEvalDb from '@iki/core/db/agent_eval';
import type {
  AgentEvalLabel,
  AgentEvalLabelType,
  AgentEvalComparison,
  RegressionAssessment,
  StepComparison,
} from '@iki/core/types/agent_run';

export const createChatEval = (deps?: {
  exportTrace?: (
    runId: string
  ) => Promise<{ success: boolean; filePath?: string; error?: string }>;
}) => {
  const exportTrace = deps?.exportTrace ?? (async () => ({ success: false, error: 'not supported' }));

  const addLabel = (input: {
    runId: string;
    stepId?: string | null;
    label: string;
    note?: string | null;
  }): AgentEvalLabel => {
    return agentEvalDb.createEvalLabel({
      runId: input.runId,
      stepId: input.stepId ?? null,
      label: input.label as AgentEvalLabelType,
      note: input.note ?? null,
    });
  };

  const listLabels = (runId: string): AgentEvalLabel[] => {
    return agentEvalDb.listEvalLabelsByRun(runId);
  };

  const deleteLabel = (labelId: string): { success: boolean } => {
    return agentEvalDb.deleteEvalLabel(labelId);
  };

  const compareRuns = (
    baselineRunId: string,
    testRunId: string
  ): AgentEvalComparison | null => {
    const traceA = agentRunDb.getAgentRunTrace(baselineRunId);
    const traceB = agentRunDb.getAgentRunTrace(testRunId);

    if (!traceA || !traceB) return null;

    const labels = agentEvalDb.listEvalLabelsByRun(baselineRunId);
    const labelsByStepIndex = new Map<number, AgentEvalLabel[]>();
    for (const label of labels) {
      if (!label.stepId) continue;
      const step = traceA.steps.find(s => s.id === label.stepId);
      if (!step) continue;
      const existing = labelsByStepIndex.get(step.stepIndex);
      if (existing) {
        existing.push(label);
      } else {
        labelsByStepIndex.set(step.stepIndex, [label]);
      }
    }

    const maxSteps = Math.max(traceA.steps.length, traceB.steps.length);
    let sharedToolCalls = 0;

    const stepComparison: StepComparison[] = [];
    for (let i = 0; i < maxSteps; i++) {
      const stepA = traceA.steps[i] ?? null;
      const stepB = traceB.steps[i] ?? null;
      const stepType = (stepA?.type ?? stepB?.type ?? 'model') as StepComparison['type'];
      const match =
        !!stepA &&
        !!stepB &&
        stepA.type === stepB.type &&
        stepA.status === stepB.status;

      if (match && stepA.type === 'tool-call') {
        sharedToolCalls += 1;
      }

      stepComparison.push({
        stepIndex: i,
        type: stepType,
        baselineStep: stepA,
        comparisonStep: stepB,
        match,
        labels: stepA ? (labelsByStepIndex.get(stepA.stepIndex) ?? []) : [],
      });
    }

    return {
      runA: traceA,
      runB: traceB,
      stepComparison,
      totalStepsA: traceA.steps.length,
      totalStepsB: traceB.steps.length,
      sharedToolCalls,
    };
  };

  const assessRegression = (
    baselineRunId: string,
    testRunId: string
  ): RegressionAssessment | null => {
    const comparison = compareRuns(baselineRunId, testRunId);
    if (!comparison) return null;

    const labels = agentEvalDb.listEvalLabelsByRun(baselineRunId);
    const stepLabels = labels.filter(l => l.stepId);
    const labelCount = stepLabels.length;

    if (labelCount === 0) {
      return {
        baselineRunId,
        testRunId,
        status: 'pending',
        totalSteps: comparison.stepComparison.length,
        incorrectSteps: 0,
        partialSteps: 0,
        correctSteps: 0,
        labelCount: 0,
      };
    }

    const incorrectSteps = stepLabels.filter(l => l.label === 'incorrect').length;
    const partialSteps = stepLabels.filter(l => l.label === 'partial').length;
    const correctSteps = stepLabels.filter(l => l.label === 'correct').length;

    const status = incorrectSteps > 0 ? 'fail' : 'pass';

    return {
      baselineRunId,
      testRunId,
      status,
      totalSteps: comparison.stepComparison.length,
      incorrectSteps,
      partialSteps,
      correctSteps,
      labelCount,
    };
  };

  return {
    exportTrace,
    addLabel,
    listLabels,
    deleteLabel,
    compareRuns,
    assessRegression,
  };
};

export type ChatEval = ReturnType<typeof createChatEval>;
