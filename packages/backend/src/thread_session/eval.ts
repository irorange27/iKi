import * as agentEvalDb from '@iki/backend/db/agent_eval';
import type { AgentEvalLabel, AgentEvalLabelType } from '@iki/backend/types/agent_run';

import { exportRunTrajectory } from './atif_export';

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

  return {
    exportTrace,
    exportRunTrajectory,
    addLabel,
    listLabels,
    deleteLabel,
  };
};

export type ChatEval = ReturnType<typeof createChatEval>;
