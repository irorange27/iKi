import * as agentRunDb from '@iki/backend/db/agent_runs';
import type { ChatServicePlatformDeps } from '@iki/backend/chat_platform';
import { noopPlatformDeps } from '@iki/backend/chat_platform';
import type { ChatStreamTarget } from './types';
import { createChatApproval } from './approval';
import { createChatMemory } from './memory';
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
import { setChatServicePlatformDeps, onMessagePersisted } from './platform';
import { deriveResumeStreamOptions, rebuildResumeHistoryFromEvents } from './run_rehydrator';
import type { AgentRun, AgentRunKind } from '@iki/backend/types/agent_run';
import { getErrorMessage } from '@iki/backend/utils/errors';
import type { ModelMessage } from '../message/model_history';
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
      registerExecution: streamCoordinator.registerExecution,
      registerChildRunAlias: streamCoordinator.registerChildRunAlias,
    },
    memory,
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
  // targets the ORIGINAL task: the dead attempts' committed output is
  // excluded (see deadTaskChainRunIds below — the whole dead task chain,
  // never a succeeded or blocked run). Facts stay in the log; display and
  // replay show the whole story. A run whose log has no usable history — or
  // whose replay does not end with the recorded task (a user message) —
  // refuses loudly BEFORE any successor row is created. Kind admission is
  // per caller: retry opens the wake/task send kinds whose id-less sends
  // record input facts (issue #139); resumeRun stays chat-turn-only — a
  // blocked task row recovers via the approval flow or re-scheduling, not a
  // handoff-resume that would bypass the approval gate. Continuation kinds
  // (handoff-resume, approval-resume) and delegated-agent (its own harness,
  // no send facts) refuse everywhere.
  // The dead attempts of a run's task (issue #141, the F3 ledger's
  // consecutive-failure attribution): the retried run itself, its
  // failed/cancelled ancestors (each retry's parent — a succeeded ancestor
  // like an awaiter-wake's origin run is real history, a blocked one is live
  // approval state; neither is ever excluded), and the failed/cancelled
  // descendants (a succeeded descendant's output is real history the user
  // saw — excluding it would re-run the task past it and duplicate its
  // effects). An earlier failure's committed text must not stand between the
  // task and the retry: stacked failures brick the retry surface otherwise.
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
    { history: ModelMessage[]; systemPrompts: string[] } | { refusal: { success: false; error: string } }
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
      // The recovery-input owner throws when a journaled effect of the dead
      // chain cannot be represented from the log (#143) — a refusal, not an
      // exception past the IPC boundary.
      return { refusal: { success: false, error: getErrorMessage(error) } };
    }
    const last = recovered?.history[recovered.history.length - 1];
    // A tool tail is a CONTINUATION (#143): the recovery history carries the
    // dead chain's journaled exchange pairs after the task input, and the
    // resumed turn runs with an empty prompt over existing history. A plain
    // assistant tail is still no task to re-run.
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
    // Attribution join (#139 review): when the tail input fact carries the
    // run it was accepted for, the retried run must be that run or its
    // descendant — otherwise the replay's tail is a LATER send's task and
    // the re-run would execute it under this run's plan (the silent
    // wrong-task re-run the gate exists to prevent, in a retry-after-resend
    // interleaving). Facts without a runId (chat sends, pre-#139 rows) skip
    // the join; their tail semantics are the F3 contract.
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
          // The queued row IS the executing identity: claim it instead of
          // spawning a third run id beside a never-claimed queued record.
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
    // The retryRun status gate, checked before the history refusal so a
    // non-retryable run reports the status, not the missing facts.
    if (original.status !== 'failed' && original.status !== 'cancelled') {
      return { success: false, error: `Cannot retry a run with status ${original.status}` };
    }

    // Refuse before the queued successor row exists — no orphan retry rows.
    // The wake/task send kinds are admitted here (issue #139): their id-less
    // sends record input facts, so the retry re-runs the recorded TASK.
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
        // The retry keeps the original's kind: the successor row, the plan
        // and the turn_started fact must attribute the re-run to the same
        // kind the task entered with (issue #139).
        kind: original.kind,
        parentRunId: runId,
        // The queued retry row is adopted as the executing identity.
        adoptRunId: retryResult.newRunId,
        metadata: {
          source: 'retry',
          originalRunId: runId,
        },
        inputMessages: recovered.history,
        systemPrompts: recovered.systemPrompts,
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
    // User-driven history rewrite (edit/resend truncate): the ONE backend
    // owner — rows and their session-log fact land in one transaction.
    truncateAfterMessage,
  };
};

export type ChatService = ReturnType<typeof createChatService>;
