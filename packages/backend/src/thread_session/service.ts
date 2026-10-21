import * as agentRunDb from '@iki/backend/db/agent_runs';
import type { ChatServicePlatformDeps } from '@iki/backend/chat_platform';
import { noopPlatformDeps } from '@iki/backend/chat_platform';
import type { ChatStreamTarget } from './types';
import { createChatApproval } from './approval';
import { createChatPersistence } from '../turn_prep/persistence';
import { createChatRuns } from './runs';
import { truncateAfterMessage } from './history_truncation';
import { createChatEval } from './eval';
import { createChatStreaming } from './session_loop';
import { createThreadStreamCoordinator } from './thread_stream_coordinator';
import {
  hasLiveThreadRunLease,
  tryAcquireCrossProcessThreadRun,
} from '@iki/backend/db/thread_run_locks';
import { createChatUsage } from './usage';
import { setChatServicePlatformDeps } from './platform';
import { deriveResumeStreamOptions, rebuildResumeHistoryFromEvents } from './run_rehydrator';
import type { AgentRun, AgentRunKind } from '@iki/backend/types/agent_run';
import { getErrorMessage } from '@iki/backend/utils/errors';
import type { ModelMessage } from '../message/model_history';
import {
  buildThreadMarkdown,
  parseStoredMessageForExport,
} from '../message/thread_markdown_export';
import { searchThreadContent } from '../message/thread_content_search';

export type { ChatStreamTarget } from './types';

export const createChatService = (platformDeps?: ChatServicePlatformDeps) => {
  const deps = platformDeps ?? noopPlatformDeps;
  setChatServicePlatformDeps(deps);

  const usage = createChatUsage();

  const streamCoordinator = createThreadStreamCoordinator({
    crossProcessThreadRun: (threadId, options) =>
      tryAcquireCrossProcessThreadRun(threadId, { onLeaseLost: options.onLeaseLost }),
  });
  const persistence = createChatPersistence();
  const approvals = createChatApproval({
    streams: {
      tryAcquireThreadRun: streamCoordinator.tryAcquireThreadRun,
      peek: streamCoordinator.peekStream,
      attach: streamCoordinator.attachStream,
      detach: streamCoordinator.detachStream,
      registerExecution: streamCoordinator.registerExecution,
      registerChildRunAlias: streamCoordinator.registerChildRunAlias,
    },
    conversation: persistence,
    usage: {
      recordUsageEvent: usage.recordUsageEvent,
    },
  });
  const runs = createChatRuns({
    abortActiveStream: streamCoordinator.abortStreamByRunId,
    cancelExecution: streamCoordinator.cancelExecutionByRunId,
    hasLiveThreadLease: hasLiveThreadRunLease,
    cancelPendingApprovalsForRun: approvals.cancelPendingApprovalsForRun,
  });
  const eval_ = createChatEval({ exportTrace: deps.exportTrace });
  const streaming = createChatStreaming({
    streamCoordinator,
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

  const deadTaskChainRunIds = (run: AgentRun): string[] => {
    const chain = new Set<string>([run.id]);
    const isDead = (row: AgentRun | null) =>
      !!row && (row.status === 'failed' || row.status === 'cancelled');
    let ancestor = run.parentRunId ? agentRunDb.getAgentRun(run.parentRunId) : null;
    while (ancestor) {
      if (!isDead(ancestor)) break;
      chain.add(ancestor.id);
      ancestor = ancestor.parentRunId ? agentRunDb.getAgentRun(ancestor.parentRunId) : null;
    }
    const rows = run.threadId ? agentRunDb.listAgentRunsByThread(run.threadId) : [];
    let grew = true;
    while (grew) {
      grew = false;
      for (const row of rows) {
        if (chain.has(row.id) || !isDead(row) || !row.parentRunId) continue;
        if (chain.has(row.parentRunId)) {
          chain.add(row.id);
          grew = true;
        }
      }
    }
    return [...chain];
  };

  const resumeHistoryOrRefusal = async (
    run: AgentRun,
    admittedKinds: readonly AgentRunKind[]
  ): Promise<
    | { history: ModelMessage[]; systemPrompts: string[] }
    | { refusal: { success: false; error: string } }
  > => {
    if (!run.threadId) return { refusal: { success: false, error: 'Run has no thread ID' } };
    if (!admittedKinds.includes(run.kind)) {
      return {
        refusal: {
          success: false,
          error: `Run ${run.id} has kind ${run.kind}; session-log resume is admitted for: ${admittedKinds.join(', ')}.`,
        },
      };
    }
    const excludeRunIds = deadTaskChainRunIds(run);
    let recovered: Awaited<ReturnType<typeof rebuildResumeHistoryFromEvents>>;
    try {
      recovered = await rebuildResumeHistoryFromEvents(run.threadId, excludeRunIds);
    } catch (error) {

      return { refusal: { success: false, error: getErrorMessage(error) } };
    }
    const last = recovered?.history[recovered.history.length - 1];

    const tailIsRecoverable =
      last?.role === 'user' || (recovered?.continuation === true && last?.role === 'tool');
    if (!recovered || recovered.history.length === 0 || !tailIsRecoverable) {
      return {
        refusal: {
          success: false,
          error: `Run ${run.id} has no recorded session facts ending in its task to resume from.`,
        },
      };
    }

    if (recovered.inputRunId) {
      const ancestry = new Set<string>([run.id]);
      let ancestor = run.parentRunId ? agentRunDb.getAgentRun(run.parentRunId) : null;
      while (ancestor) {
        ancestry.add(ancestor.id);
        ancestor = ancestor.parentRunId ? agentRunDb.getAgentRun(ancestor.parentRunId) : null;
      }
      if (!ancestry.has(recovered.inputRunId)) {
        return {
          refusal: {
            success: false,
            error: `Run ${run.id} cannot resume: the replay's tail input was recorded for run ${recovered.inputRunId}, not this run's task.`,
          },
        };
      }
    }
    return recovered;
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

    const recovered = await resumeHistoryOrRefusal(run, ['chat-turn']);
    if ('refusal' in recovered) return recovered.refusal;

    if (run.status === 'queued') {
      const result = await streaming.stream(
        target,
        deriveResumeStreamOptions(run, {
          kind: 'chat-turn',
          parentRunId: run.parentRunId ?? undefined,

          adoptRunId: run.id,
          metadata: {
            source: 'execute-queued',
            originalRunId: run.id,
          },
          inputMessages: recovered.history,
          systemPrompts: recovered.systemPrompts,
        })
      );
      return { success: true, ...(result as Record<string, unknown>) };
    }
    const result = await streaming.stream(
      target,
      deriveResumeStreamOptions(run, {
        kind: 'chat-turn',
        parentRunId: run.id,
        metadata: {
          source: 'resume',
          originalRunId: run.id,
          blockedAt: run.updatedAt,
          ...(run.working.lastStepIndex > 0 ? { resumeFromStep: run.working.lastStepIndex } : {}),
        },

        continuePrompt: 'Continue the work that was interrupted.',
        inputMessages: recovered.history,
        systemPrompts: recovered.systemPrompts,
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

    if (original.status !== 'failed' && original.status !== 'cancelled') {
      return { success: false, error: `Cannot retry a run with status ${original.status}` };
    }

    const recovered = await resumeHistoryOrRefusal(original, [
      'chat-turn',
      'proactive-task',
      'awaiter-wake',
    ]);
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

        kind: original.kind,
        parentRunId: runId,

        adoptRunId: retryResult.newRunId,
        metadata: {
          source: 'retry',
          originalRunId: runId,
        },
        inputMessages: recovered.history,
        systemPrompts: recovered.systemPrompts,
      })
    );

    return {
      success: true,
      newRunId: retryResult.newRunId,
      ...(result as Record<string, unknown>),
    };
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

    truncateAfterMessage,
  };
};

export type ChatService = ReturnType<typeof createChatService>;
