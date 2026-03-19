import type { ToolApprovalResponse } from 'ai';

import type { ConversationRunner } from '../../../core/agent';
import * as chatMessageDb from '../../../core/db/chat_message';
import * as chatThreadDb from '../../../core/db/chat_thread';
import { buildSkillsSystemPrompt, normalizeSkillIds } from '../../../core/skills';
import { defaultToolRegistry } from '../../../core/tools';
import { isObjectRecord } from '../../../shared/chat/tool_parts';
import { getErrorMessage } from '../../utils/errors';
import { TOOL_AGENT_SYSTEM_PROMPT } from './chat_constants';
import type { ChatMemory } from './chat_memory';
import type { ActiveStreamState, ChatWebContents } from './chat_types';
import { createUiChunkEmitter, parseStoredUiMessageRow, toModelInputMessages } from './chat_ui';
import { createChatConversationRunner } from './chat_conversation_runner';
import { createToolLoopRunner } from './chat_tool_loop';
import type { ParsedUiMessage } from '../../../shared/chat/ui_message_codec';

type PendingApprovalSession = {
  runner: ConversationRunner;
  webContents: ChatWebContents;
  pendingApprovalIds: Set<string>;
  collectedApprovalResponses: Map<string, ToolApprovalResponse>;
};

export const createChatApproval = (deps: {
  activeStreams: Map<number, ActiveStreamState>;
  memory: ChatMemory;
}) => {
  const pendingApprovalSessions = new Map<string, PendingApprovalSession>();

  const ensurePendingApprovalSession = (
    approvalId: string,
    session: { runner: ConversationRunner; webContents: ChatWebContents }
  ) => {
    const existing = pendingApprovalSessions.get(approvalId);
    if (existing) return existing;

    const created: PendingApprovalSession = {
      runner: session.runner,
      webContents: session.webContents,
      pendingApprovalIds: new Set([approvalId]),
      collectedApprovalResponses: new Map(),
    };
    pendingApprovalSessions.set(approvalId, created);
    return created;
  };

  const registerApprovalBatch = (
    approvalRequests: Array<{ approvalId: string }>,
    session: { runner: ConversationRunner; webContents: ChatWebContents }
  ) => {
    const approvalIds = approvalRequests
      .map(request => request.approvalId)
      .filter(id => typeof id === 'string' && id.length > 0);

    if (approvalIds.length === 0) return;

    const pendingSession: PendingApprovalSession = {
      runner: session.runner,
      webContents: session.webContents,
      pendingApprovalIds: new Set(approvalIds),
      collectedApprovalResponses: new Map(),
    };

    for (const approvalId of approvalIds) {
      pendingApprovalSessions.set(approvalId, pendingSession);
    }
  };

  const toolLoopRunner = createToolLoopRunner({ registerApprovalBatch });

  const getPendingApprovalIdsFromUiMessage = (message: ParsedUiMessage): string[] => {
    const parts = Array.isArray(message.parts) ? (message.parts as unknown[]) : [];
    const ids: string[] = [];

    for (const part of parts) {
      if (!isObjectRecord(part)) continue;
      if (part.type !== 'dynamic-tool') continue;
      if (part.state !== 'approval-requested') continue;

      const approvalId =
        typeof part.approvalId === 'string'
          ? part.approvalId
          : isObjectRecord(part.approval) && typeof part.approval.id === 'string'
            ? part.approval.id
            : '';

      if (approvalId) ids.push(approvalId);
    }

    return ids;
  };

  const getToolNameForApproval = (message: ParsedUiMessage, approvalId: string): string | null => {
    const parts = Array.isArray(message.parts) ? (message.parts as unknown[]) : [];
    for (const part of parts) {
      if (!isObjectRecord(part)) continue;
      if (part.type !== 'dynamic-tool') continue;
      if (part.state !== 'approval-requested') continue;

      const partApprovalId =
        typeof part.approvalId === 'string'
          ? part.approvalId
          : isObjectRecord(part.approval) && typeof part.approval.id === 'string'
            ? part.approval.id
            : '';

      if (partApprovalId !== approvalId) continue;
      if (typeof part.toolName === 'string' && part.toolName.trim()) {
        return part.toolName.trim();
      }
    }
    return null;
  };

  const tryRecoverApprovalSession = async (
    approvalId: string,
    webContents: ChatWebContents
  ): Promise<PendingApprovalSession | null> => {
    if (!approvalId || typeof approvalId !== 'string') return null;
    const needle = approvalId.trim();
    if (!needle) return null;

    // 1) Find a message that contains this approval id and is still pending.
    const candidates = chatMessageDb.findChatMessagesByMessageSubstring(needle, 50);
    const match = candidates.find(row => {
      const ui = parseStoredUiMessageRow({ id: row.id, message: row.message });
      return getPendingApprovalIdsFromUiMessage(ui).includes(needle);
    });

    if (!match) return null;

    const threadId = typeof match.thread_id === 'string' ? match.thread_id : '';
    if (!threadId) return null;

    // 2) Load thread context (provider/model/tools/skills)
    const thread = chatThreadDb.getChatThread(threadId);
    if (!thread) return null;

    let providerType = '';
    let model = '';
    try {
      const meta = thread.metadata ? JSON.parse(thread.metadata) : {};
      if (isObjectRecord(meta) && isObjectRecord(meta.llm)) {
        if (typeof meta.llm.providerType === 'string') providerType = meta.llm.providerType;
        if (typeof meta.llm.model === 'string') model = meta.llm.model;
      }
    } catch {
      // ignore
    }

    if (!model && typeof thread.model === 'string') {
      model = thread.model;
    }

    // providerType is mandatory for rebuilding the agent; without it we cannot reliably resume.
    if (!providerType || !model) {
      console.warn('[Main] Cannot recover approval session: missing providerType/model', {
        threadId,
        providerType,
        model,
      });
      return null;
    }

    let toolNames: string[] = [];
    if (thread.tools) {
      try {
        const parsed = JSON.parse(thread.tools);
        if (Array.isArray(parsed)) {
          toolNames = parsed.filter(
            (t): t is string => typeof t === 'string' && t.trim().length > 0
          );
        }
      } catch {
        toolNames = [];
      }
    }

    // 3) Rebuild tool list if thread.tools was not persisted (older threads).
    if (toolNames.length === 0) {
      const toolName = getToolNameForApproval(
        parseStoredUiMessageRow({ id: match.id, message: match.message }),
        needle
      );
      if (toolName) toolNames = [toolName];
    }

    // 4) Load UI messages from DB and convert them back to model messages (AI SDK boundary).
    const rows = chatMessageDb.getChatMessages(threadId);
    const uiMessages = rows.map(row =>
      parseStoredUiMessageRow({ id: row.id, message: row.message })
    );
    const inputMessages = deps.memory.injectMemoryIntoMessages(
      await toModelInputMessages(uiMessages),
      threadId
    );

    // 5) Rebuild agent + pending approval batch.
    let normalizedSkillIds: string[] = [];
    try {
      if (thread.skill_ids) {
        normalizedSkillIds = normalizeSkillIds(JSON.parse(thread.skill_ids));
      }
    } catch {
      normalizedSkillIds = [];
    }
    const skillsSystemPrompt =
      normalizedSkillIds.length > 0 ? await buildSkillsSystemPrompt(normalizedSkillIds) : '';

    const runner = createChatConversationRunner({
      providerType,
      model,
      systemPrompt: [TOOL_AGENT_SYSTEM_PROMPT, skillsSystemPrompt].filter(Boolean).join('\n\n'),
      enableTools: true,
      maxIterations: 5,
    });

    for (const name of toolNames) {
      const tool = defaultToolRegistry.get(name);
      if (tool) runner.registerTool(tool);
    }

    runner.setModelMessages(inputMessages);

    const pendingApprovalIds = new Set<string>();
    for (const ui of uiMessages) {
      for (const id of getPendingApprovalIdsFromUiMessage(ui)) {
        pendingApprovalIds.add(id);
      }
    }

    if (pendingApprovalIds.size === 0) {
      return null;
    }

    const session: PendingApprovalSession = {
      runner,
      webContents,
      pendingApprovalIds,
      collectedApprovalResponses: new Map(),
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
    let session = pendingApprovalSessions.get(approvalId);
    if (!session) {
      session = await tryRecoverApprovalSession(approvalId, webContents);
    }
    if (!session) {
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
    deps.activeStreams.set(resumedSenderId, streamState);

    try {
      const streamResult = await toolLoopRunner.stream({
        runner: session.runner,
        webContents: session.webContents,
        prompt: '',
        approvalResponses: Array.from(session.collectedApprovalResponses.values()),
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
            });
          }
          uiChunkEmitter.emitToolEvent(eventPart);
        },
        abortSignal: streamState.abortController.signal,
        uiChunkEmitter,
      });
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
