import type { ModelMessage, ToolApprovalResponse } from 'ai';

import {
  type AgentStep,
  type AgentResult,
} from '@iki/backend/agent';
import { appendApprovalResponsesToHistory } from '../provider/ai_sdk_runtime';
import { cloneModelMessages } from '../agent/harness';
import type { AgentRun } from '@iki/backend/types/agent_run';
import * as agentRunDb from '@iki/backend/db/agent_runs';
import * as chatToolApprovalDb from '@iki/backend/db/chat_tool_approval';
import * as chatMessageDb from '@iki/backend/db/chat_message';
import { runWithToolRuntimeContext } from '../tools/runtime_context';
import type { ChatToolApprovalDecision } from '@iki/backend/types/chat_tool_approval';
import { getErrorMessage } from '@iki/backend/utils/errors';
import type { ChatMemory } from '../chat_service/memory';
import type { ApprovalRecoveryContext, ToolLoopStreamResult } from './approval_types';
import { resolveChatToolMaxIterations } from '../chat_service/constants';
import { createAgentRunTracker } from '../agent_session/run_tracker';
import type { ActiveStreamState, ChatStreamTarget, ChatStreamEvent } from '../chat_service/types';
import { createUiChunkEmitter } from '../chat_service/ui_stream';
import { toModelInputMessages } from '../chat_service/ui_messages';
import { parseStoredUiMessageRow } from '@iki/backend/chat/ui_message_codec';
import { AgentHarness } from '../agent/harness';
import type { TurnOutput } from '../agent/harness/harness_types';

const APPROVAL_TIMEOUT_MS = 30 * 60 * 1000;

type PendingApprovalSession = {
  sessionId?: string;
  target: ChatStreamTarget;
  recoveryContext?: ApprovalRecoveryContext;
  history?: ModelMessage[];
  pendingApprovalIds: Set<string>;
  collectedApprovalResponses: Map<string, ToolApprovalResponse>;
  timeouts: Map<string, ReturnType<typeof setTimeout>>;
};

const parseStringArray = (value: string | null | undefined): string[] => {
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
  } catch {
    return [];
  }
};

const getRunMaxIterations = (run: AgentRun | null | undefined): number | undefined => {
  const value = run?.input?.metadata?.maxIterations;
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return Math.max(1, Math.trunc(value));
};

export const createChatApproval = (deps: {
  activeStreams: Map<number, ActiveStreamState>;
  memory: ChatMemory;
  usage: {
    recordUsageEvent: (params: {
      threadId?: string;
      messageId?: string;
      providerType: string;
      model: string;
      usage?: {
        inputTokens?: number;
        outputTokens?: number;
        totalTokens?: number;
        cacheReadTokens?: number;
        cacheWriteTokens?: number;
        reasoningTokens?: number;
        estimatedCostUsd?: number;
      };
      source?: string;
      metadata?: Record<string, unknown>;
    }) => void;
  };
}) => {
  const pendingApprovalSessions = new Map<string, PendingApprovalSession>();

  const clearApprovalTimeouts = (session: PendingApprovalSession) => {
    if (!session.timeouts) return;
    for (const timeoutId of session.timeouts.values()) {
      clearTimeout(timeoutId);
    }
    session.timeouts.clear();
  };

  const scheduleApprovalTimeout = (approvalId: string, session: PendingApprovalSession) => {
    if (!session.timeouts || session.timeouts.has(approvalId)) return;
    const timeoutId = setTimeout(() => {
      if (session.collectedApprovalResponses.has(approvalId)) return;
      session.collectedApprovalResponses.set(approvalId, {
        type: 'tool-approval-response' as const,
        approvalId,
        approved: false,
        reason: 'Approval timed out after 30 minutes',
      });
      session.timeouts.delete(approvalId);
    }, APPROVAL_TIMEOUT_MS);
    session.timeouts.set(approvalId, timeoutId);
  };

  const ensurePendingApprovalSession = (
    approvalId: string,
    session: {
      target: ChatStreamTarget;
      history?: ModelMessage[];
      recoveryContext?: ApprovalRecoveryContext;
    }
  ) => {
    const existing = pendingApprovalSessions.get(approvalId);
    if (existing) {
      existing.target = session.target;
      existing.history = session.history ?? existing.history;
      existing.recoveryContext = session.recoveryContext ?? existing.recoveryContext;
      if (session.recoveryContext?.sessionId) {
        existing.sessionId = session.recoveryContext.sessionId;
      }
      existing.pendingApprovalIds.add(approvalId);
      scheduleApprovalTimeout(approvalId, existing);
      return existing;
    }

    const created: PendingApprovalSession = {
      sessionId: session.recoveryContext?.sessionId,
      target: session.target,
      history: session.history,
      recoveryContext: session.recoveryContext,
      pendingApprovalIds: new Set([approvalId]),
      collectedApprovalResponses: new Map(),
      timeouts: new Map(),
    };
    pendingApprovalSessions.set(approvalId, created);
    scheduleApprovalTimeout(approvalId, created);
    return created;
  };

  const registerApprovalBatch = (
    approvalRequests: Array<{
      approvalId: string;
      toolCallId?: string;
      toolCall?: { toolName: string; args: Record<string, unknown> };
    }>,
    session: {
      target: ChatStreamTarget;
      history?: ModelMessage[];
      recoveryContext?: ApprovalRecoveryContext;
    }
  ) => {
    const approvalIds = approvalRequests
      .map(request => request.approvalId)
      .filter(id => typeof id === 'string' && id.length > 0);

    if (approvalIds.length === 0) return;

    if (session.recoveryContext) {
      const recoveryContext = session.recoveryContext;
      chatToolApprovalDb.upsertChatToolApprovalSession({
        session_id: recoveryContext.sessionId,
        thread_id: recoveryContext.threadId,
        assistant_message_id: recoveryContext.assistantMessageId,
        run_id: recoveryContext.runId ?? null,
        provider_type: recoveryContext.providerType,
        provider_id: recoveryContext.providerId ?? null,
        model: recoveryContext.model,
        system_prompt: recoveryContext.systemPrompt,
        max_input_tokens: recoveryContext.maxInputTokens ?? null,
        max_output_tokens: recoveryContext.maxOutputTokens ?? null,
        max_iterations: recoveryContext.maxIterations ?? null,
        enabled_tools: JSON.stringify(recoveryContext.enabledTools),
        available_skill_ids: JSON.stringify(recoveryContext.availableSkillIds),
      });

      chatToolApprovalDb.upsertChatToolApprovals(
        approvalRequests.map(request => ({
          approval_id: request.approvalId,
          session_id: recoveryContext.sessionId,
          tool_call_id: request.toolCallId || null,
          tool_name: request.toolCall?.toolName || null,
          tool_args: request.toolCall ? JSON.stringify(request.toolCall.args ?? {}) : null,
          state: 'pending',
        }))
      );
    }

    let existingSession: PendingApprovalSession | undefined;
    for (const approvalId of approvalIds) {
      const candidate = pendingApprovalSessions.get(approvalId);
      if (candidate) {
        existingSession = candidate;
        break;
      }
    }

    if (existingSession) {
      existingSession.target = session.target;
      existingSession.history = session.history ?? existingSession.history;
      existingSession.recoveryContext = session.recoveryContext ?? existingSession.recoveryContext;
      if (session.recoveryContext?.sessionId) {
        existingSession.sessionId = session.recoveryContext.sessionId;
      }
      for (const approvalId of approvalIds) {
        existingSession.pendingApprovalIds.add(approvalId);
        pendingApprovalSessions.set(approvalId, existingSession);
        scheduleApprovalTimeout(approvalId, existingSession);
      }
      return;
    }

    const pendingSession: PendingApprovalSession = {
      sessionId: session.recoveryContext?.sessionId,
      target: session.target,
      history: session.history,
      recoveryContext: session.recoveryContext,
      pendingApprovalIds: new Set(approvalIds),
      collectedApprovalResponses: new Map(),
      timeouts: new Map(),
    };

    for (const approvalId of approvalIds) {
      pendingApprovalSessions.set(approvalId, pendingSession);
      scheduleApprovalTimeout(approvalId, pendingSession);
    }
  };

  const tryRecoverApprovalSession = async (
    approvalId: string,
    target: ChatStreamTarget
  ): Promise<PendingApprovalSession | null> => {
    if (!approvalId || typeof approvalId !== 'string') return null;
    const needle = approvalId.trim();
    if (!needle) return null;

    const approvalRecord = chatToolApprovalDb.getChatToolApproval(needle);
    if (!approvalRecord || approvalRecord.state === 'consumed') {
      return null;
    }

    const approvalSession = chatToolApprovalDb.getChatToolApprovalSession(
      approvalRecord.session_id
    );
    if (!approvalSession) return null;

    const activeApprovals = chatToolApprovalDb.getActiveChatToolApprovalsBySession(
      approvalSession.session_id
    );
    if (activeApprovals.length === 0) {
      return null;
    }

    const fallbackToolNames = Array.from(
      new Set(
        activeApprovals
          .map(record => (typeof record.tool_name === 'string' ? record.tool_name.trim() : ''))
          .filter(Boolean)
      )
    );
    const storedRunId = typeof approvalSession.run_id === 'string' ? approvalSession.run_id.trim() : '';
    const runSnapshot =
      (storedRunId ? agentRunDb.getLatestAgentRunCheckpoint(storedRunId)?.snapshot : null) ??
      (storedRunId ? agentRunDb.getAgentRun(storedRunId) : null);
    const activeApprovalIds = activeApprovals.map(record => record.approval_id);
    const runPendingApprovalIds = new Set(runSnapshot?.working.pendingApprovalIds ?? []);
    const historyFromRun =
      runSnapshot &&
      (runSnapshot.status === 'blocked' ||
        activeApprovalIds.some(activeApprovalId => runPendingApprovalIds.has(activeApprovalId)))
        ? await toModelInputMessages(runSnapshot.working.modelMessages)
        : null;

    const threadId = runSnapshot?.threadId ?? approvalSession.thread_id;
    if (!threadId) return null;

    const inputMessages =
      historyFromRun && historyFromRun.length > 0
        ? historyFromRun
        : await (async () => {
            const rows = chatMessageDb.getChatMessages(threadId);
            if (rows.length === 0) return null;
            const uiMessages = rows.map(row =>
              parseStoredUiMessageRow({ id: row.id, message: row.message })
            );
            return await deps.memory.injectMemoryIntoMessages(
              await toModelInputMessages(uiMessages),
              threadId,
              { skipRetrieval: true }
            );
          })();

    if (!inputMessages || inputMessages.length === 0) return null;

    const toolNames =
      runSnapshot?.enabledTools ?? parseStringArray(approvalSession.enabled_tools);
    const availableSkillIds =
      runSnapshot?.availableSkillIds ?? parseStringArray(approvalSession.available_skill_ids);
    const resolvedToolNames =
      toolNames.length > 0
        ? toolNames
        : Array.from(
          new Set(
            [...fallbackToolNames, ...activeApprovals.map(record => record.tool_name ?? '')]
              .map(toolName => (typeof toolName === 'string' ? toolName.trim() : ''))
              .filter(Boolean)
          )
        );
    const maxIterations = resolveChatToolMaxIterations(
      getRunMaxIterations(runSnapshot) ?? approvalSession.max_iterations ?? undefined
    );

    const pendingApprovalIds = new Set(activeApprovals.map(record => record.approval_id));
    const collectedApprovalResponses = new Map<string, ToolApprovalResponse>();
    for (const record of activeApprovals) {
      if (record.state !== 'answered' || !record.decision) continue;
      collectedApprovalResponses.set(record.approval_id, {
        type: 'tool-approval-response',
        approvalId: record.approval_id,
        approved: record.decision === 'approved',
        reason:
          typeof record.decision_reason === 'string' && record.decision_reason.trim()
            ? record.decision_reason
            : record.decision === 'approved'
              ? 'User approved tool execution.'
              : 'User rejected tool execution.',
      });
    }

    const session: PendingApprovalSession = {
      sessionId: approvalSession.session_id,
      target,
      history: inputMessages,
      recoveryContext: {
        sessionId: approvalSession.session_id,
        threadId,
        assistantMessageId: approvalSession.assistant_message_id,
        ...(storedRunId ? { runId: storedRunId } : {}),
        providerType: runSnapshot?.providerType ?? approvalSession.provider_type,
        ...((runSnapshot?.providerId ?? approvalSession.provider_id) &&
        typeof (runSnapshot?.providerId ?? approvalSession.provider_id) === 'string' &&
        (runSnapshot?.providerId ?? approvalSession.provider_id)?.trim()
          ? { providerId: (runSnapshot?.providerId ?? approvalSession.provider_id)?.trim() }
          : {}),
        model: runSnapshot?.model ?? approvalSession.model,
        systemPrompt: runSnapshot?.systemPrompt ?? approvalSession.system_prompt,
        ...(typeof approvalSession.max_input_tokens === 'number'
          ? { maxInputTokens: approvalSession.max_input_tokens }
          : {}),
        ...(typeof approvalSession.max_output_tokens === 'number'
          ? { maxOutputTokens: approvalSession.max_output_tokens }
          : {}),
        maxIterations,
        enabledTools: resolvedToolNames,
        availableSkillIds,
      },
      pendingApprovalIds,
      collectedApprovalResponses,
      timeouts: new Map(),
    };

    for (const id of pendingApprovalIds) {
      pendingApprovalSessions.set(id, session);
      scheduleApprovalTimeout(id, session);
    }

    return session;
  };

  const approveTool = async (
    target: ChatStreamTarget,
    approvalId: string,
    approved: boolean
  ) => {
    const storedApproval = chatToolApprovalDb.getChatToolApproval(approvalId);
    let session = pendingApprovalSessions.get(approvalId);
    if (!session) {
      session = await tryRecoverApprovalSession(approvalId, target);
    }
    if (!session) {
      if (storedApproval && storedApproval.state !== 'pending') {
        return {
          success: false,
          error: 'Approval request already processed.',
        };
      }
      return {
        success: false,
        error: 'Approval request not found or already processed.',
      };
    }

    // Ensure the resumed stream emits UI chunks to the window that initiated the approval.
    session.target = target;

    const approvalResponse: ToolApprovalResponse = {
      type: 'tool-approval-response',
      approvalId,
      approved,
      reason: approved ? 'User approved tool execution.' : 'User rejected tool execution.',
    };

    if (session.collectedApprovalResponses.has(approvalId)) {
      const existing = session.collectedApprovalResponses.get(approvalId);
      // Idempotent: if the same decision was already recorded, treat as success
      if (existing && existing.approved === approved) {
        return { success: true };
      }
      return {
        success: false,
        error: 'Approval request already processed.',
      };
    }

    session.collectedApprovalResponses.set(approvalId, approvalResponse);
    const decision: ChatToolApprovalDecision = approved ? 'approved' : 'rejected';
    chatToolApprovalDb.answerChatToolApproval(approvalId, decision, approvalResponse.reason);

    const waitingForApprovals = Array.from(session.pendingApprovalIds).filter(
      id => !session.collectedApprovalResponses.has(id)
    );

    if (waitingForApprovals.length > 0) {
      return {
        success: true,
        awaitingApproval: true,
        waitingForApprovals,
      };
    }

    clearApprovalTimeouts(session);
    for (const pendingId of session.pendingApprovalIds) {
      pendingApprovalSessions.delete(pendingId);
    }
    if (session.sessionId) {
      chatToolApprovalDb.consumeChatToolApprovalSession(session.sessionId);
    }

    const resumedSenderId = session.target.id;
    const existingStream = deps.activeStreams.get(resumedSenderId);
    if (existingStream) {
      existingStream.cancelled = true;
      existingStream.abortController.abort('resume-after-tool-approval');
    }

    const streamState: ActiveStreamState = {
      cancelled: false,
      stoppedByUser: false,
      abortController: new AbortController(),
    };
    const uiChunkEmitter = createUiChunkEmitter(session.target);
    const baseApprovalContext = session.recoveryContext
      ? {
          ...session.recoveryContext,
          sessionId: uiChunkEmitter.messageId,
          assistantMessageId: uiChunkEmitter.messageId,
        }
      : undefined;
    const resumeRunTracker = baseApprovalContext
      ? createAgentRunTracker({
          kind: 'approval-resume',
          threadId: baseApprovalContext.threadId,
          parentRunId: session.recoveryContext?.runId,
          providerType: baseApprovalContext.providerType,
          providerId: baseApprovalContext.providerId,
          model: baseApprovalContext.model,
          systemPrompt: baseApprovalContext.systemPrompt,
          enabledTools: baseApprovalContext.enabledTools,
          availableSkillIds: baseApprovalContext.availableSkillIds ?? [],
          input: {
            messages: session.history ?? [],
            metadata: {
              transport: 'approval-resume',
              sourceSessionId: session.sessionId ?? session.recoveryContext?.sessionId ?? null,
              sourceRunId: session.recoveryContext?.runId ?? null,
              answeredApprovalIds: Array.from(session.collectedApprovalResponses.keys()),
              maxIterations: baseApprovalContext.maxIterations,
              enableTools:
                baseApprovalContext.enabledTools.length > 0 ||
                (baseApprovalContext.availableSkillIds?.length ?? 0) > 0,
              assistantMessageId: uiChunkEmitter.messageId,
            },
          },
          working: {
            modelMessages: session.history ?? [],
            accumulatedText: '',
            pendingApprovalIds: Array.from(session.pendingApprovalIds).filter(
              id => !session.collectedApprovalResponses.has(id)
            ),
            lastStepIndex: 0,
          },
        })
      : null;
    const nextApprovalContext = baseApprovalContext
      ? {
          ...baseApprovalContext,
          ...(resumeRunTracker ? { runId: resumeRunTracker.id } : {}),
        }
      : undefined;
    deps.activeStreams.set(resumedSenderId, streamState);
    let resolvedHistory: ModelMessage[] | undefined = session.history;
    let isAwaitingApproval = false;

    try {
      const ctx = nextApprovalContext ?? session.recoveryContext;
      const streamResult = await runWithToolRuntimeContext(
        {
          runId: resumeRunTracker?.id ?? nextApprovalContext?.runId,
          ...(resumeRunTracker ? { runTracker: resumeRunTracker } : {}),
          threadId: nextApprovalContext?.threadId ?? session.recoveryContext?.threadId,
          conversationModel: {
            providerType: ctx?.providerType ?? '',
            providerId: ctx?.providerId,
            model: ctx?.model ?? '',
          },
        },
        async () => {
          // Create a fresh harness from the recovery context
          const approvalThreadId =
            nextApprovalContext?.threadId ?? session.recoveryContext?.threadId;
          const harnessCfg = {
            providerType: ctx?.providerType ?? '',
            providerId: ctx?.providerId,
            model: ctx?.model ?? '',
            systemPrompt: ctx?.systemPrompt ?? '',
            enableTools: true,
            enabledToolNames: ctx?.enabledTools ?? [],
            availableSkillIds: ctx?.availableSkillIds ?? [],
            guardActive: false,
            maxIterations: ctx?.maxIterations ?? 10,
            ...(approvalThreadId ? { threadId: approvalThreadId } : {}),
            ...(typeof ctx?.maxOutputTokens === 'number'
              ? { maxOutputTokens: ctx.maxOutputTokens }
              : {}),
          };
          const approvalHarness = new AgentHarness(harnessCfg);

          // Build history with collected approval responses
          const responses = Array.from(session.collectedApprovalResponses.values());
          let streamHistory = cloneModelMessages(session.history ?? []);
          if (responses.length > 0) {
            streamHistory = appendApprovalResponsesToHistory(
              streamHistory,
              responses.map(r => ({
                type: 'tool-approval-response' as const,
                approvalId: r.approvalId,
                approved: r.approved,
                ...(r.reason ? { reason: r.reason } : {}),
              }))
            );
          }

          let awaitingApproval = false;
          let cancelled = false;
          let responseText = '';
          let agentResult: AgentResult | undefined;

          for await (const turnEvent of approvalHarness.turn({
            prompt: '',
            history: streamHistory,
            runTracker: resumeRunTracker ?? undefined,
            abortSignal: streamState.abortController.signal,
          })) {
            if (streamState.cancelled) {
              cancelled = true;
              approvalHarness.cancel();
              break;
            }

            if (turnEvent.event === 'step') {
              const step = turnEvent.step;
              if (step.type === 'message_update') {
                responseText += step.text;
                uiChunkEmitter.emitTextDelta(step.text);
              } else if (step.type === 'tool_execution_start') {
                const event: ChatStreamEvent = {
                  type: 'tool-call',
                  toolCallId: step.toolCallId,
                  toolName: step.toolName,
                  input: step.input,
                };
                resumeRunTracker?.recordToolEvent(event);
                uiChunkEmitter.emitToolEvent(event);
              } else if (step.type === 'tool_execution_end') {
                if (step.outcome === 'success') {
                  const event: ChatStreamEvent = {
                    type: 'tool-result',
                    toolCallId: step.toolCallId,
                    output: step.output,
                  };
                  resumeRunTracker?.recordToolEvent(event);
                  uiChunkEmitter.emitToolEvent(event);
                } else {
                  const event: ChatStreamEvent = {
                    type: 'tool-error',
                    toolCallId: step.toolCallId,
                    error: step.error ?? 'Tool execution failed',
                  };
                  resumeRunTracker?.recordToolEvent(event);
                  uiChunkEmitter.emitToolEvent(event);
                }
              } else if (step.type === 'approval_request') {
                awaitingApproval = true;
                for (const req of step.requests) {
                  if (req.approvalId) {
                    ensurePendingApprovalSession(req.approvalId, {
                      target: session.target,
                      history: approvalHarness.getHistory(),
                      recoveryContext: nextApprovalContext,
                    });
                  }
                }
                for (const req of step.requests) {
                  if (req.approvalId) {
                    uiChunkEmitter.emitToolEvent({
                      type: 'tool-approval-request',
                      approvalId: req.approvalId,
                      toolCallId: req.toolCallId || '',
                      ...(req.toolCall
                        ? {
                            toolCall: {
                              toolName: req.toolCall.toolName,
                              toolCallId: req.toolCallId || '',
                              args: req.toolCall.args ?? {},
                            },
                          }
                        : {}),
                    });
                  }
                }
              }
            } else if (turnEvent.event === 'done') {
              const output = turnEvent.output;
              agentResult = {
                response: output.text,
                toolCalls: output.toolCalls,
                toolApprovalRequests: output.toolApprovalRequests,
                usage: output.usage,
                iterations: 0,
                requiresApproval: output.requiresApproval,
              } as AgentResult;
            }
          }

          const result: ToolLoopStreamResult = {
            awaitingApproval:
              awaitingApproval || (agentResult?.requiresApproval ?? false),
            cancelled,
            ...(agentResult?.response
              ? { response: agentResult.response }
              : responseText
                ? { response: responseText }
                : {}),
            usage: agentResult?.usage,
          };

          // Track history for subsequent getHistory() calls
          resolvedHistory = approvalHarness.getHistory();

          return result;
        }
      );
      isAwaitingApproval = streamResult.awaitingApproval;
      if (streamResult.cancelled) {
        uiChunkEmitter.abort();
      } else if (!isAwaitingApproval) {
        uiChunkEmitter.finish();
      }

      resumeRunTracker?.syncModelMessages(resolvedHistory ?? session.history ?? []);
      if (!streamResult.cancelled && nextApprovalContext) {
        deps.usage.recordUsageEvent({
          threadId: nextApprovalContext.threadId,
          messageId: uiChunkEmitter.messageId,
          providerType: nextApprovalContext.providerType,
          model: nextApprovalContext.model,
          usage: streamResult.usage,
          source: 'chat.approval-stream',
          metadata: {
            sessionId: nextApprovalContext.sessionId,
            awaitingApproval: streamResult.awaitingApproval,
          },
        });
      }
      if (resumeRunTracker) {
        if (streamResult.cancelled) {
          resumeRunTracker.markCancelled({
            ...(streamResult.response ? { text: streamResult.response } : {}),
          });
        } else if (streamResult.awaitingApproval) {
          resumeRunTracker.markBlocked({
            ...(streamResult.response ? { text: streamResult.response } : {}),
            usage: streamResult.usage ? { ...streamResult.usage } : undefined,
          });
        } else {
          resumeRunTracker.markCompleted({
            ...(streamResult.response ? { text: streamResult.response } : {}),
            usage: streamResult.usage ? { ...streamResult.usage } : undefined,
            finishReason: 'completed',
          });
        }
      }
      return {
        success: true,
        awaitingApproval: streamResult.awaitingApproval,
        stopped: streamState.stoppedByUser,
      };
    } catch (error: unknown) {
      const message = getErrorMessage(error);
      if (streamState.cancelled) {
        uiChunkEmitter.abort();
        if (resumeRunTracker && resumeRunTracker.getRun().status === 'running') {
          resumeRunTracker.markCancelled();
        }
        return { success: true, stopped: streamState.stoppedByUser };
      }
      if (resumeRunTracker && resumeRunTracker.getRun().status === 'running') {
        resumeRunTracker.markFailed({ message });
      }
      uiChunkEmitter.error(message);
      return { success: false, error: message };
    } finally {
      if (!isAwaitingApproval) {
        cleanupPendingSessionsForSender(resumedSenderId);
      }
      if (deps.activeStreams.get(resumedSenderId) === streamState) {
        deps.activeStreams.delete(resumedSenderId);
      }
    }
  };

  const cleanupPendingSessionsForSender = (senderId: number) => {
    for (const [key, session] of pendingApprovalSessions) {
      if (session.target.id === senderId) {
        clearApprovalTimeouts(session);
        pendingApprovalSessions.delete(key);
      }
    }
  };

  return { approveTool, ensurePendingApprovalSession, registerApprovalBatch, cleanupPendingSessionsForSender };
};

export type ChatApproval = ReturnType<typeof createChatApproval>;
