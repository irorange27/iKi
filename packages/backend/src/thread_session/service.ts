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
import { setChatServicePlatformDeps, onMessagePersisted } from './platform';
import { deriveResumeStreamOptions, rebuildResumeHistoryFromEvents } from './run_rehydrator';
import type { AgentRun } from '@iki/backend/types/agent_run';
import type { ModelMessage } from 'ai';
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
  const persistence = createChatPersistence({
    memory,
    onContinuityMessagePersisted: onMessagePersisted,
  });
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

  // ADR 008 F3: the recovery history comes from the session log replay —
  // the run row's input copy is no longer read as authority. The re-run
  // targets the ORIGINAL task: the dead run's own committed output is
  // excluded (its facts stay in the log; display and replay still show the
  // whole story). A run whose log has no usable history refuses loudly
  // BEFORE any successor row is created.
  const resumeHistoryOrRefusal = async (
    run: AgentRun
  ): Promise<{ history: ModelMessage[] } | { refusal: { success: false; error: string } }> => {
    if (!run.threadId) return { refusal: { success: false, error: 'Run has no thread ID' } };
    const history = await rebuildResumeHistoryFromEvents(run.threadId, run.id);
    if (!history || history.length === 0) {
      return {
        refusal: {
          success: false,
          error: `Run ${run.id} has no recorded session facts to resume from.`,
        },
      };
    }
    return { history };
  };

  const resumeRun = async (
    target: ChatStreamTarget,
    runId: string
  ): Promise<{ success: boolean; error?: string }> => {
    const run = agentRunDb.getAgentRun(runId);
    if (!run) return { success: false, error: 'Run not found' };
    if (run.status !== 'blocked' && run.status !== 'queued') {
      return { success: false, error: `Cannot resume a run with status ${run.status}` };
    }

    const recovered = await resumeHistoryOrRefusal(run);
    if ('refusal' in recovered) return recovered.refusal;

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
          inputMessages: recovered.history,
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
        inputMessages: recovered.history,
      })
    );

    return { success: true, ...(result as Record<string, unknown>) };
  };

  const retryAndExecute = async (
    target: ChatStreamTarget,
    runId: string
  ): Promise<{ success: boolean; error?: string; newRunId?: string }> => {
    const original = agentRunDb.getAgentRun(runId);
    if (!original) return { success: false, error: 'Run not found' };

    // Refuse before the queued successor row exists — no orphan retry rows.
    const recovered = await resumeHistoryOrRefusal(original);
    if ('refusal' in recovered) return recovered.refusal;

    const retryResult = runs.retryRun(runId);
    if (!retryResult.success || !retryResult.newRunId) {
      return retryResult;
    }

    const newRun = agentRunDb.getAgentRun(retryResult.newRunId);
    if (!newRun) {
      return { success: false, error: 'Retry run was created but could not be loaded' };
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
        inputMessages: recovered.history,
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
