import type { ModelMessage, ToolApprovalResponse } from 'ai';

import type { ConversationRunner } from '../../../core/agent';
import * as chatToolApprovalDb from '../../../core/db/chat_tool_approval';
import * as chatMessageDb from '../../../core/db/chat_message';
import { defaultToolRegistry } from '../../../core/tools';
import { runWithToolRuntimeContext } from '../../../core/tools/runtime_context';
import type { ChatToolApprovalDecision } from '../../../shared/types/chat_tool_approval';
import { getErrorMessage } from '../../utils/errors';
import type { ChatMemory } from './chat_memory';
import type { ApprovalRecoveryContext } from './chat_approval_types';
import type { ActiveStreamState, ChatWebContents } from './chat_types';
import { createUiChunkEmitter, parseStoredUiMessageRow, toModelInputMessages } from './chat_ui';
import { createChatConversationRunner } from './chat_conversation_runner';
import { createToolLoopRunner } from './chat_tool_loop';

type PendingApprovalSession = {
  sessionId?: string;
  runner: ConversationRunner;
  webContents: ChatWebContents;
  recoveryContext?: ApprovalRecoveryContext;
  history?: ModelMessage[];
  pendingApprovalIds: Set<string>;
  collectedApprovalResponses: Map<string, ToolApprovalResponse>;
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

  const ensurePendingApprovalSession = (
    approvalId: string,
    session: {
      runner: ConversationRunner;
      webContents: ChatWebContents;
      recoveryContext?: ApprovalRecoveryContext;
    }
  ) => {
    const existing = pendingApprovalSessions.get(approvalId);
    if (existing) {
      existing.webContents = session.webContents;
      existing.recoveryContext = session.recoveryContext ?? existing.recoveryContext;
      if (session.recoveryContext?.sessionId) {
        existing.sessionId = session.recoveryContext.sessionId;
      }
      existing.pendingApprovalIds.add(approvalId);
      return existing;
    }

    const created: PendingApprovalSession = {
      sessionId: session.recoveryContext?.sessionId,
      runner: session.runner,
      webContents: session.webContents,
      recoveryContext: session.recoveryContext,
      pendingApprovalIds: new Set([approvalId]),
      collectedApprovalResponses: new Map(),
    };
    pendingApprovalSessions.set(approvalId, created);
    return created;
  };

  const registerApprovalBatch = (
    approvalRequests: Array<{
      approvalId: string;
      toolCallId?: string;
      toolCall?: { toolName: string; args: Record<string, unknown> };
    }>,
    session: {
      runner: ConversationRunner;
      webContents: ChatWebContents;
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
        provider_type: recoveryContext.providerType,
        model: recoveryContext.model,
        system_prompt: recoveryContext.systemPrompt,
        enabled_tools: JSON.stringify(recoveryContext.enabledTools),
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
      runner: session.runner,
      webContents: session.webContents,
      recoveryContext: session.recoveryContext,
      pendingApprovalIds: new Set(approvalIds),
      collectedApprovalResponses: new Map(),
    };

    for (const approvalId of approvalIds) {
      pendingApprovalSessions.set(approvalId, pendingSession);
    }
  };

  const toolLoopRunner = createToolLoopRunner({ registerApprovalBatch });

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

    const threadId = approvalSession.thread_id;
    if (!threadId) return null;

    const rows = chatMessageDb.getChatMessages(threadId);
    if (rows.length === 0) return null;

    const uiMessages = rows.map(row =>
      parseStoredUiMessageRow({ id: row.id, message: row.message })
    );
    const inputMessages = deps.memory.injectMemoryIntoMessages(
      await toModelInputMessages(uiMessages),
      threadId
    );

    let toolNames: string[] = [];
    if (approvalSession.enabled_tools) {
      try {
        const parsed = JSON.parse(approvalSession.enabled_tools);
        if (Array.isArray(parsed)) {
          toolNames = parsed.filter(
            (t): t is string => typeof t === 'string' && t.trim().length > 0
          );
        }
      } catch {
        toolNames = [];
      }
    }

    const activeApprovals = chatToolApprovalDb.getActiveChatToolApprovalsBySession(
      approvalSession.session_id
    );
    if (activeApprovals.length === 0) {
      return null;
    }

    if (toolNames.length === 0) {
      toolNames = Array.from(
        new Set(
          activeApprovals
            .map(record => (typeof record.tool_name === 'string' ? record.tool_name.trim() : ''))
            .filter(Boolean)
        )
      );
    }

    const runner = createChatConversationRunner({
      providerType: approvalSession.provider_type,
      model: approvalSession.model,
      systemPrompt: approvalSession.system_prompt,
      enableTools: true,
      maxIterations: 5,
    });

    for (const name of toolNames) {
      const tool = defaultToolRegistry.get(name);
      if (tool) runner.registerTool(tool);
    }

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
      runner,
      webContents,
      history: inputMessages,
      recoveryContext: {
        sessionId: approvalSession.session_id,
        threadId: approvalSession.thread_id,
        assistantMessageId: approvalSession.assistant_message_id,
        providerType: approvalSession.provider_type,
        model: approvalSession.model,
        systemPrompt: approvalSession.system_prompt,
        enabledTools: toolNames,
      },
      pendingApprovalIds,
      collectedApprovalResponses,
    };

    for (const id of pendingApprovalIds) {
      pendingApprovalSessions.set(id, session);
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
    const nextApprovalContext = session.recoveryContext
      ? {
          ...session.recoveryContext,
          sessionId: uiChunkEmitter.messageId,
          assistantMessageId: uiChunkEmitter.messageId,
        }
      : undefined;
    deps.activeStreams.set(resumedSenderId, streamState);

    try {
      const streamResult = await runWithToolRuntimeContext(
        { threadId: nextApprovalContext?.threadId || session.recoveryContext?.threadId },
        async () =>
          await toolLoopRunner.stream({
            runner: session.runner,
            webContents: session.webContents,
            history: session.history,
            prompt: '',
            approvalResponses: Array.from(session.collectedApprovalResponses.values()),
            approvalContext: nextApprovalContext,
            shouldCancel: () => streamState.cancelled,
            onToolEvent: eventPart => {
              if (
                eventPart.type === 'tool-approval-request' &&
                typeof eventPart.approvalId === 'string' &&
                eventPart.approvalId.length > 0
              ) {
                ensurePendingApprovalSession(eventPart.approvalId, {
                  runner: session.runner,
                  webContents: session.webContents,
                  recoveryContext: nextApprovalContext,
                });
              }
              uiChunkEmitter.emitToolEvent(eventPart);
            },
            abortSignal: streamState.abortController.signal,
            uiChunkEmitter,
          })
      );
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
      return {
        success: true,
        awaitingApproval: streamResult.awaitingApproval,
        stopped: streamState.stoppedByUser,
      };
    } catch (error: unknown) {
      const message = getErrorMessage(error);
      if (streamState.cancelled) {
        uiChunkEmitter.abort();
        return { success: true, stopped: streamState.stoppedByUser };
      }
      uiChunkEmitter.error(message);
      return { success: false, error: message };
    } finally {
      if (deps.activeStreams.get(resumedSenderId) === streamState) {
        deps.activeStreams.delete(resumedSenderId);
      }
    }
  };

  return { approveTool, ensurePendingApprovalSession, registerApprovalBatch };
};

export type ChatApproval = ReturnType<typeof createChatApproval>;
