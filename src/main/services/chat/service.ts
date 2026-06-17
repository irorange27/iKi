import * as agentRunDb from '../../../core/db/agent_runs';
import type { ActiveStreamState, ChatWebContents } from './types';
import { createChatApproval } from './approval';
import { createChatMemory } from './memory';
import { createChatPersistence } from './persistence';
import { createChatRuns } from './runs';
import { createChatEval } from './eval';
import { createChatStreaming } from './streaming';
import { createChatUsage } from './usage';

export type { ChatWebContents } from './types';

export const createChatService = () => {
  const activeStreams = new Map<number, ActiveStreamState>();

  const memory = createChatMemory();
  const usage = createChatUsage();
  const approvals = createChatApproval({
    activeStreams,
    memory,
    usage: {
      recordUsageEvent: usage.recordUsageEvent,
    },
  });
  const persistence = createChatPersistence({ memory });
  const runs = createChatRuns({ activeStreams });
  const eval_ = createChatEval();
  const streaming = createChatStreaming({
    activeStreams,
    memory,
    getThreadTitle: (id: string) => persistence.getThread(id)?.title,
    usage: {
      recordUsageEvent: usage.recordUsageEvent,
    },
    approvals: {
      ensurePendingApprovalSession: approvals.ensurePendingApprovalSession,
      registerApprovalBatch: approvals.registerApprovalBatch,
      cleanupPendingSessionsForWebContents: approvals.cleanupPendingSessionsForWebContents,
    },
  });

  const resumeRun = async (
    webContents: ChatWebContents,
    runId: string
  ): Promise<{ success: boolean; error?: string }> => {
    const run = agentRunDb.getAgentRun(runId);
    if (!run) return { success: false, error: 'Run not found' };
    if (run.status !== 'blocked' && run.status !== 'queued') {
      return { success: false, error: `Cannot resume a run with status ${run.status}` };
    }
    if (!run.threadId) {
      return { success: false, error: 'Run has no thread ID' };
    }

    if (run.status === 'queued') {
      const result = await streaming.stream(webContents, {
        providerType: run.providerType,
        providerId: run.providerId ?? undefined,
        model: run.model,
        messages: [],
        threadId: run.threadId,
        tools: run.enabledTools,
        skillIds: run.availableSkillIds,
        runConfig: {
          kind: 'chat-turn',
          parentRunId: run.parentRunId ?? undefined,
          rootRunId: run.rootRunId,
          metadata: {
            source: 'execute-queued',
            originalRunId: run.id,
          },
        },
      });
      return { success: true, ...(result as Record<string, unknown>) };
    }

    const checkpoint = agentRunDb.getLatestAgentRunCheckpoint(runId);
    const snapshot = checkpoint?.snapshot;

    const result = await streaming.stream(webContents, {
      providerType: run.providerType,
      providerId: run.providerId ?? undefined,
      model: run.model,
      messages: [],
      threadId: run.threadId,
      tools: run.enabledTools,
      skillIds: run.availableSkillIds,
      runConfig: {
        kind: 'handoff-resume',
        parentRunId: run.id,
        rootRunId: run.rootRunId,
        metadata: {
          source: 'resume',
          originalRunId: run.id,
          blockedAt: run.updatedAt,
          ...(checkpoint?.stepIndex !== undefined ? { resumeFromStep: checkpoint.stepIndex } : {}),
        },
      },
      autonomous: snapshot?.working?.pendingApprovalIds?.length
        ? {
            maxIterations: 10,
            continuePrompt: 'Continue the work that was interrupted.',
          }
        : undefined,
    });

    return { success: true, ...(result as Record<string, unknown>) };
  };

  const retryAndExecute = async (
    webContents: ChatWebContents,
    runId: string
  ): Promise<{ success: boolean; error?: string; newRunId?: string }> => {
    const retryResult = runs.retryRun(runId);
    if (!retryResult.success || !retryResult.newRunId) {
      return retryResult;
    }

    const newRun = agentRunDb.getAgentRun(retryResult.newRunId);
    if (!newRun) {
      return { success: false, error: 'Retry run was created but could not be loaded' };
    }
    if (!newRun.threadId) {
      return { success: false, error: 'Original run has no thread ID' };
    }

    const result = await streaming.stream(webContents, {
      providerType: newRun.providerType,
      providerId: newRun.providerId ?? undefined,
      model: newRun.model,
      messages: [],
      threadId: newRun.threadId,
      tools: newRun.enabledTools,
      skillIds: newRun.availableSkillIds,
      runConfig: {
        kind: 'chat-turn',
        parentRunId: runId,
        rootRunId: newRun.rootRunId,
        metadata: {
          source: 'retry',
          originalRunId: runId,
        },
      },
    });

    return { success: true, newRunId: retryResult.newRunId, ...(result as Record<string, unknown>) };
  };

  return {
    ...persistence,
    ...runs,
    ...streaming,
    eval: eval_,
    getUsageSummary: usage.getUsageSummary,
    approveTool: approvals.approveTool,
    resumeRun,
    retryAndExecute,
  };
};

export type ChatService = ReturnType<typeof createChatService>;

export const chatService: ChatService = createChatService();
