import * as agentRunDb from '@iki/backend/db/agent_runs';
import type { ChatServicePlatformDeps } from '@iki/backend/chat_platform';
import { noopPlatformDeps } from '@iki/backend/chat_platform';
import type { ActiveStreamState, ChatStreamTarget } from './types';
import { createChatApproval } from '../agent_session/approval';
import { createChatMemory } from './memory';
import { createChatPersistence } from '../agent_session/persistence';
import { createChatRuns } from './runs';
import { createChatEval } from './eval';
import { createChatStreaming } from './streaming';
import { createThreadStreamCoordinator } from './thread_stream_coordinator';
import { createChatUsage } from './usage';
import { setChatServicePlatformDeps } from './platform';

export type { ChatStreamTarget } from './types';

export const createChatService = (platformDeps?: ChatServicePlatformDeps) => {
  const deps = platformDeps ?? noopPlatformDeps;
  setChatServicePlatformDeps(deps);

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
  const eval_ = createChatEval({ exportTrace: deps.exportTrace });
  const streamCoordinator = createThreadStreamCoordinator({ activeStreams });
  const streaming = createChatStreaming({
    streamCoordinator,
    memory,
    getThreadTitle: (id: string) => persistence.getThread(id)?.title,
    usage: {
      recordUsageEvent: usage.recordUsageEvent,
    },
    approvals: {
      ensurePendingApprovalSession: approvals.ensurePendingApprovalSession,
      registerApprovalBatch: approvals.registerApprovalBatch,
      cleanupPendingSessionsForSender: approvals.cleanupPendingSessionsForSender,
    },
  });

  const resumeRun = async (
    target: ChatStreamTarget,
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
      const result = await streaming.stream(target, {
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

    const result = await streaming.stream(target, {
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
          ...(run.working.lastStepIndex > 0 ? { resumeFromStep: run.working.lastStepIndex } : {}),
        },
      },
      autonomous: run.working.pendingApprovalIds.length > 0
        ? {
            maxIterations: 10,
            continuePrompt: 'Continue the work that was interrupted.',
          }
        : undefined,
    });

    return { success: true, ...(result as Record<string, unknown>) };
  };

  const retryAndExecute = async (
    target: ChatStreamTarget,
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

    const result = await streaming.stream(target, {
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
