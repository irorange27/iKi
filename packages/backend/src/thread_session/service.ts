import * as agentRunDb from '@iki/backend/db/agent_runs';
import type { ChatServicePlatformDeps } from '@iki/backend/chat_platform';
import { noopPlatformDeps } from '@iki/backend/chat_platform';
import type { ChatStreamTarget } from './types';
import { createChatApproval } from './approval';
import { createChatMemory } from './memory';
import { createChatPersistence } from '../turn_prep/persistence';
import { createChatRuns } from './runs';
import { createChatEval } from './eval';
import { createChatStreaming } from './session_loop';
import { createThreadStreamCoordinator } from './thread_stream_coordinator';
import { tryAcquireCrossProcessThreadRun } from '@iki/backend/db/thread_run_locks';
import { createChatUsage } from './usage';
import { setChatServicePlatformDeps } from './platform';
import { deriveResumeStreamOptions } from './run_rehydrator';
import { buildThreadMarkdown, parseStoredMessageForExport } from '../message/thread_markdown_export';
import { searchThreadContent } from '../message/thread_content_search';

export type { ChatStreamTarget } from './types';

export const createChatService = (platformDeps?: ChatServicePlatformDeps) => {
  const deps = platformDeps ?? noopPlatformDeps;
  setChatServicePlatformDeps(deps);

  const memory = createChatMemory();
  const usage = createChatUsage();
  // The SQLite lease extends per-thread admission across processes sharing
  // this database (desktop window + headless daemon both enter here).
  const streamCoordinator = createThreadStreamCoordinator({
    crossProcessThreadRun: (threadId, options) =>
      tryAcquireCrossProcessThreadRun(threadId, { onLeaseLost: options.onLeaseLost }),
  });
  const persistence = createChatPersistence({ memory });
  const approvals = createChatApproval({
    streams: {
      tryAcquireThreadRun: streamCoordinator.tryAcquireThreadRun,
      peek: streamCoordinator.peekStream,
      attach: streamCoordinator.attachStream,
      detach: streamCoordinator.detachStream,
    },
    memory,
    conversation: persistence,
    usage: {
      recordUsageEvent: usage.recordUsageEvent,
    },
  });
  const runs = createChatRuns({
    abortActiveStream: streamCoordinator.abortStreamByRunId,
    cancelPendingApprovalsForRun: approvals.cancelPendingApprovalsForRun,
  });
  const eval_ = createChatEval({ exportTrace: deps.exportTrace });
  const streaming = createChatStreaming({
    streamCoordinator,
    memory,
    conversation: persistence,
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
      const result = await streaming.stream(
        target,
        deriveResumeStreamOptions(run, {
          kind: 'chat-turn',
          parentRunId: run.parentRunId ?? undefined,
          // The queued row IS the executing identity: claim it instead of
          // spawning a third run id beside a never-claimed queued record.
          adoptRunId: run.id,
          metadata: {
            source: 'execute-queued',
            originalRunId: run.id,
          },
        })
      );
      return { success: true, ...(result as Record<string, unknown>) };
    }    const result = await streaming.stream(
      target,
      deriveResumeStreamOptions(run, {
        kind: 'handoff-resume',
        parentRunId: run.id,
        metadata: {
          source: 'resume',
          originalRunId: run.id,
          blockedAt: run.updatedAt,
          ...(run.working.lastStepIndex > 0 ? { resumeFromStep: run.working.lastStepIndex } : {}),
        },
        autonomous: run.working.pendingApprovalIds.length > 0
          ? {
              maxIterations: 10,
              continuePrompt: 'Continue the work that was interrupted.',
            }
          : undefined,
      })
    );

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

    const result = await streaming.stream(
      target,
      deriveResumeStreamOptions(newRun, {
        kind: 'chat-turn',
        parentRunId: runId,
        // The queued retry row is adopted as the executing identity.
        adoptRunId: retryResult.newRunId,
        metadata: {
          source: 'retry',
          originalRunId: runId,
        },
      })
    );

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
    searchThreadContent,
  };
};

export type ChatService = ReturnType<typeof createChatService>;
