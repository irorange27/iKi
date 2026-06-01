import { dialog } from 'electron';
import * as fs from 'node:fs';
import * as agentRunDb from '../../../core/db/agent_runs';
import * as agentEvalDb from '../../../core/db/agent_eval';
import type {
  AgentEvalLabel,
  AgentEvalLabelType,
  AgentEvalComparison,
  EvalExportPayload,
  RegressionAssessment,
  StepComparison,
} from '../../../shared/types/agent_run';
import { toIsoNow } from '../../../shared/utils/text';

export const createChatEval = () => {
  const exportTrace = async (
    runId: string
  ): Promise<{ success: boolean; filePath?: string; error?: string }> => {
    const trace = agentRunDb.getAgentRunTrace(runId);
    if (!trace) {
      return { success: false, error: 'Run not found' };
    }

    const labels = agentEvalDb.listEvalLabelsByRun(runId);

    const payload: EvalExportPayload = {
      exportedAt: toIsoNow(),
      version: '1',
      trace,
      labels,
    };

    const result = await dialog.showSaveDialog({
      title: 'Export Agent Run Trace',
      defaultPath: `agent-trace-${runId}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });

    if (result.canceled || !result.filePath) {
      return { success: false, error: 'cancelled' };
    }

    try {
      fs.writeFileSync(result.filePath, JSON.stringify(payload, null, 2), 'utf-8');
      return { success: true, filePath: result.filePath };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  };

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
