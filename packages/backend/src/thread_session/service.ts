import * as agentRunDb from '@iki/backend/db/agent_runs';
import type { ChatServicePlatformDeps } from '@iki/backend/chat_platform';
import { noopPlatformDeps } from '@iki/backend/chat_platform';
import type { ChatStreamTarget } from './types';
import { createChatApproval } from '../turn_prep/approval';
import { createChatMemory } from './memory';
import { createChatPersistence } from '../turn_prep/persistence';
import { createChatRuns } from './runs';
import { createChatEval } from './eval';
import { createChatStreaming } from './session_loop';
import { createThreadStreamCoordinator } from './thread_stream_coordinator';
import { createChatUsage } from './usage';
import { setChatServicePlatformDeps } from './platform';
import { buildThreadMarkdown, parseStoredMessageForExport } from '../chat/thread_markdown_export';

export type { ChatStreamTarget } from './types';

export const createChatService = (platformDeps?: ChatServicePlatformDeps) => {
  const deps = platformDeps ?? noopPlatformDeps;
  setChatServicePlatformDeps(deps);

  const memory = createChatMemory();
  const usage = createChatUsage();
  const streamCoordinator = createThreadStreamCoordinator();
  const approvals = createChatApproval({
    streams: {
      peek: streamCoordinator.peekStream,
      attach: streamCoordinator.attachStream,
      detach: streamCoordinator.detachStream,
    },
    memory,
    usage: {
      recordUsageEvent: usage.recordUsageEvent,
    },
  });
  const persistence = createChatPersistence({ memory });
  const runs = createChatRuns({ abortActiveStream: streamCoordinator.abortStreamByRunId });
  const eval_ = createChatEval({ exportTrace: deps.exportTrace });
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
  ): Promise<{ success: boolean; error?: string }> => {    const run = agentRunDb.getAgentRun(runId);
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

  const exportThreadMarkdown = async (
    threadId: string
  ): Promise<{ success: boolean; filePath?: string; error?: string }> => {
    if (!deps.exportThreadMarkdown) {
      return { success: false, error: 'Thread export is not available in this host.' };
    }

    const thread = persistence.getThread(threadId);
    if (!thread) return { success: false, error: 'Thread not found' };

    const rows = persistence.listMessages(threadId);
    const messages = rows
      .map(row => parseStoredMessageForExport(row.message))
      .filter((message): message is NonNullable<typeof message> => message !== null);

    const content = buildThreadMarkdown({
      title: thread.title || threadId,
      model: typeof thread.model === 'string' ? thread.model : undefined,
      exportedAt: new Date().toISOString(),
      messages,
    });

    return await deps.exportThreadMarkdown({ threadId, title: thread.title || threadId, content });
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
    exportThreadMarkdown,
  };
};

export type ChatService = ReturnType<typeof createChatService>;
