import type { ModelMessage, ToolApprovalResponse } from 'ai';

import {
  createConversationHarness,
  type AgentTool,
  type ConversationHarness,
} from '../../../core/agent';
import type { AgentRun } from '../../../shared/types/agent_run';
import { getAppConfig } from '../../../core/config';
import * as agentRunDb from '../../../core/db/agent_runs';
import * as chatToolApprovalDb from '../../../core/db/chat_tool_approval';
import * as chatMessageDb from '../../../core/db/chat_message';
import { defaultToolRegistry } from '../../../core/tools';
import { LoadSkillTool } from '../../../core/tools/skill_tools';
import { runWithToolRuntimeContext } from '../../../core/tools/runtime_context';
import { applyToolApprovalPolicy } from '../../../shared/utils/tool_approval';
import type { ChatToolApprovalDecision } from '../../../shared/types/chat_tool_approval';
import { getErrorMessage } from '../../utils/errors';
import type { ChatMemory } from './chat_memory';
import type { ApprovalRecoveryContext } from './chat_approval_types';
import { resolveChatToolMaxIterations } from './chat_constants';
import { createAgentRunTracker } from './chat_run_tracking';
import type { ActiveStreamState, ChatWebContents } from './chat_types';
import { createUiChunkEmitter, parseStoredUiMessageRow, toModelInputMessages } from './chat_ui';
import { createChatConversationRunner } from './chat_conversation_runner';
import { createToolLoopRunner } from './chat_tool_loop';

const APPROVAL_TIMEOUT_MS = 30 * 60 * 1000;

type PendingApprovalSession = {
  sessionId?: string;
  harness: ConversationHarness;
  webContents: ChatWebContents;
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

  const shouldAutoApproveToolRequests = () => {
    try {
      return getAppConfig()?.general?.autoApproveToolRequests === true;
    } catch {
      return false;
    }
  };

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
      harness: ConversationHarness;
      webContents: ChatWebContents;
      history?: ModelMessage[];
      recoveryContext?: ApprovalRecoveryContext;
    }
  ) => {
    const existing = pendingApprovalSessions.get(approvalId);
    if (existing) {
      existing.webContents = session.webContents;
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
      harness: session.harness,
      webContents: session.webContents,
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
      harness: ConversationHarness;
      webContents: ChatWebContents;
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

    const pendingSession: PendingApprovalSession = {
      sessionId: session.recoveryContext?.sessionId,
      harness: session.harness,
      webContents: session.webContents,
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

  const toolLoopRunner = createToolLoopRunner({ registerApprovalBatch });

  const buildRuntimeTools = (params: {
    toolNames: string[];
    availableSkillIds: string[];
  }): AgentTool[] => {
    const registeredTools: AgentTool[] = [];

    if (params.availableSkillIds.length > 0) {
      registeredTools.push(new LoadSkillTool().toAgentTool());
    }

    for (const name of params.toolNames) {
      const tool = defaultToolRegistry.get(name);
      if (!tool) continue;
      registeredTools.push(
        applyToolApprovalPolicy(tool, {
          autoApproveToolRequests: shouldAutoApproveToolRequests(),
        })
      );
    }

    return registeredTools;
  };

  const createApprovalHarness = (params: {
    threadId: string;
    providerType: string;
    providerId?: string;
    model: string;
    systemPrompt: string;
    toolNames: string[];
    availableSkillIds: string[];
    maxIterations: number;
    maxOutputTokens?: number;
  }): ConversationHarness => {
    const runner = createChatConversationRunner({
      providerType: params.providerType,
      ...(typeof params.providerId === 'string' && params.providerId.trim()
        ? { providerId: params.providerId.trim() }
        : {}),
      model: params.model,
      systemPrompt: params.systemPrompt,
      enableTools: true,
      maxIterations: params.maxIterations,
      ...(typeof params.maxOutputTokens === 'number'
        ? { maxTokens: params.maxOutputTokens }
        : {}),
    });

    const harness = createConversationHarness({
      runner,
      toolRuntimeContext: {
        threadId: params.threadId,
        availableSkillIds: params.availableSkillIds,
        conversationModel: {
          providerType: params.providerType,
          ...(typeof params.providerId === 'string' && params.providerId.trim()
            ? { providerId: params.providerId.trim() }
            : {}),
          model: params.model,
          ...(typeof params.maxOutputTokens === 'number'
            ? { maxTokens: params.maxOutputTokens }
            : {}),
        },
        delegationDepth: 0,
      },
    });

    for (const tool of buildRuntimeTools(params)) {
      harness.registerTool(tool);
    }

    return harness;
  };

  const tryRecoverApprovalSession = async (
    approvalId: string,
    webContents: ChatWebContents
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

    const harness = createApprovalHarness({
      threadId,
      providerType: runSnapshot?.providerType ?? approvalSession.provider_type,
      ...((runSnapshot?.providerId ?? approvalSession.provider_id) &&
      typeof (runSnapshot?.providerId ?? approvalSession.provider_id) === 'string' &&
      (runSnapshot?.providerId ?? approvalSession.provider_id)?.trim()
        ? { providerId: (runSnapshot?.providerId ?? approvalSession.provider_id)?.trim() }
        : {}),
      model: runSnapshot?.model ?? approvalSession.model,
      systemPrompt: runSnapshot?.systemPrompt ?? approvalSession.system_prompt,
      toolNames: resolvedToolNames,
      availableSkillIds,
      maxIterations,
      ...(typeof approvalSession.max_output_tokens === 'number'
        ? { maxOutputTokens: approvalSession.max_output_tokens }
        : {}),
    });

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
      harness,
      webContents,
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
    webContents: ChatWebContents,
    approvalId: string,
    approved: boolean
  ) => {
    const storedApproval = chatToolApprovalDb.getChatToolApproval(approvalId);
    let session = pendingApprovalSessions.get(approvalId);
    if (!session) {
      session = await tryRecoverApprovalSession(approvalId, webContents);
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
    session.webContents = webContents;

    const approvalResponse: ToolApprovalResponse = {
      type: 'tool-approval-response',
      approvalId,
      approved,
      reason: approved ? 'User approved tool execution.' : 'User rejected tool execution.',
    };

    if (session.collectedApprovalResponses.has(approvalId)) {
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

    const resumedSenderId = session.webContents.id;
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
    const uiChunkEmitter = createUiChunkEmitter(session.webContents);
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

    try {
      const streamResult = await runWithToolRuntimeContext(
        {
          runId: resumeRunTracker?.id ?? nextApprovalContext?.runId,
          ...(resumeRunTracker ? { runTracker: resumeRunTracker } : {}),
        },
        async () =>
          await toolLoopRunner.stream({
            harness: session.harness,
            webContents: session.webContents,
            history: session.history,
            prompt: '',
            approvalResponses: Array.from(session.collectedApprovalResponses.values()),
            approvalContext: nextApprovalContext,
            autonomous: session.recoveryContext?.autonomous,
            retry: session.recoveryContext?.autonomous
              ? { maxAttempts: 3, baseDelayMs: 2000, maxDelayMs: 30000 }
              : { maxAttempts: 1, baseDelayMs: 1000, maxDelayMs: 5000 },
            shouldCancel: () => streamState.cancelled,
            onToolEvent: eventPart => {
              resumeRunTracker?.recordToolEvent(eventPart);
              if (
                eventPart.type === 'tool-approval-request' &&
                typeof eventPart.approvalId === 'string' &&
                eventPart.approvalId.length > 0
              ) {
                ensurePendingApprovalSession(eventPart.approvalId, {
                  harness: session.harness,
                  webContents: session.webContents,
                  history: session.harness.getHistory?.() ?? session.history,
                  recoveryContext: nextApprovalContext,
                });
              }
              uiChunkEmitter.emitToolEvent(eventPart);
            },
            abortSignal: streamState.abortController.signal,
            uiChunkEmitter,
            tokenUsageContext: {
              ...(typeof nextApprovalContext?.maxInputTokens === 'number'
                ? { maxInputTokens: nextApprovalContext.maxInputTokens }
                : {}),
              ...(typeof nextApprovalContext?.maxOutputTokens === 'number'
                ? { maxOutputTokens: nextApprovalContext.maxOutputTokens }
                : {}),
              ...(nextApprovalContext?.model ? { model: nextApprovalContext.model } : {}),
              ...(nextApprovalContext?.providerType
                ? { providerType: nextApprovalContext.providerType }
                : {}),
              ...(nextApprovalContext?.providerId
                ? { providerId: nextApprovalContext.providerId }
                : {}),
            },
          })
      );
      resumeRunTracker?.syncModelMessages(session.harness.getHistory?.() ?? session.history ?? []);
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
      cleanupPendingSessionsForWebContents(resumedSenderId);
      if (deps.activeStreams.get(resumedSenderId) === streamState) {
        deps.activeStreams.delete(resumedSenderId);
      }
    }
  };

  const cleanupPendingSessionsForWebContents = (senderId: number) => {
    for (const [key, session] of pendingApprovalSessions) {
      if (session.webContents.id === senderId) {
        clearApprovalTimeouts(session);
        pendingApprovalSessions.delete(key);
      }
    }
  };

  return { approveTool, ensurePendingApprovalSession, registerApprovalBatch, cleanupPendingSessionsForWebContents };
};

export type ChatApproval = ReturnType<typeof createChatApproval>;
