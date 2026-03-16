import type { ToolApprovalResponse } from 'ai';

import { SimpleAgent, type AgentResult } from '../../../core/agent';
import * as chatMessageDb from '../../../core/db/chat_message';
import * as chatThreadDb from '../../../core/db/chat_thread';
import { getConfig } from '../../../core/db/database';
import * as memoryDb from '../../../core/db/memory';
import { buildSkillsSystemPrompt, listSkills, normalizeSkillIds } from '../../../core/skills';
import { generateLongMemorySummary } from '../../../core/memory/auto_summarize';
import { analyzeEmotionWithAgent } from '../../../core/provider/emotion_model';
import * as llmFactory from '../../../core/provider/llm/factory';
import * as deepseekProvider from '../../../core/provider/llm/deepseek';
import * as kimiProvider from '../../../core/provider/llm/kimi';
import * as openaiProvider from '../../../core/provider/llm/openai';
import { selectSkillsWithAgent } from '../../../core/provider/skill_selection';
import { selectToolsWithAgent } from '../../../core/provider/tool_selection';
import { defaultToolRegistry } from '../../../core/tools';
import type { AppConfig } from '../../../shared/types/config';
import { getErrorMessage } from '../../utils/errors';
import type {
  ActiveStreamState,
  ChatInputMessage,
  ChatTransportMessage,
  ChatUiMessage,
  ChatWebContents,
  ToolStreamEvent,
  UiChunkEmitter,
} from './chat_types';
import {
  createUiChunkEmitter,
  getPromptFromMessage,
  isObjectRecord,
  parseStoredUiMessageRow,
  sanitizeUiMessageJsonForStorage,
  toAgentMessages,
  toLlmChatMessages,
  toModelInputMessages,
} from './chat_ui';

const shouldLogChunk = (count: number) => count <= 3 || count % 20 === 0;

const TOOL_AGENT_SYSTEM_PROMPT =
  'You can use tools (filesystem, shell, web) when they are necessary to solve the task.\n' +
  'Rules:\n' +
  '- Prefer answering directly when tools are not needed.\n' +
  '- Use the minimal number of tool calls needed for correctness.\n' +
  '- For each tool call, include a `description` field in the tool arguments: one short sentence explaining why you are calling the tool.\n' +
  '- Be conservative with destructive actions (writing/deleting files, risky shell commands).\n' +
  '- When using file paths, stay within the workspace.\n';

export type { ChatWebContents } from './chat_types';

const formatMemoryLine = (entry: { summary: string; score: number; updated_at?: string }) => {
  const score = Number.isFinite(entry.score) ? entry.score.toFixed(3) : '0.000';
  const dateText = entry.updated_at ? new Date(entry.updated_at).toLocaleDateString() : '';
  const summary = entry.summary.trim().replace(/\s+/g, ' ');
  return dateText ? `- (${score}, ${dateText}) ${summary}` : `- (${score}) ${summary}`;
};

const buildMemorySystemMessage = (
  entries: Array<{ summary: string; score: number; updated_at?: string }>
): string => {
  if (!entries.length) return '';
  const lines = entries.map(formatMemoryLine);
  return ['Long-term memory (use only if relevant; ignore if unrelated):', ...lines].join('\n');
};

type PendingApprovalSession = {
  agent: SimpleAgent;
  webContents: ChatWebContents;
  pendingApprovalIds: Set<string>;
  collectedApprovalResponses: Map<string, ToolApprovalResponse>;
};

export const createChatService = () => {
  const pendingApprovalSessions = new Map<string, PendingApprovalSession>();
  const activeStreams = new Map<number, ActiveStreamState>();
  const memorySummarizeInFlight = new Set<string>();

  const getMemoryConfig = () => {
    const appConfig = getConfig('app_config') as AppConfig | null;
    return appConfig?.memory || null;
  };

  const shouldAutoSummarizeThread = (threadId: string): boolean => {
    const memoryConfig = getMemoryConfig();
    if (!memoryConfig?.autoSummarize) return false;
    const thread = chatThreadDb.getChatThread(threadId);
    if (thread?.is_incognito) return false;
    return true;
  };

  const wasMessageSummarized = (threadId: string, messageId: string): boolean => {
    if (!threadId || !messageId) return false;
    const recent = memoryDb.listLongMemory(threadId, 25);
    for (const entry of recent) {
      if (!entry.source_message_ids) continue;
      try {
        const parsed = JSON.parse(entry.source_message_ids);
        if (Array.isArray(parsed) && parsed.includes(messageId)) {
          return true;
        }
      } catch {
        continue;
      }
    }
    return false;
  };

  const maybeAutoSummarizeLongMemory = async (
    threadId: string,
    messageId: string,
    messageJson?: string
  ): Promise<void> => {
    if (!threadId || !messageId || typeof messageJson !== 'string') return;
    if (!shouldAutoSummarizeThread(threadId)) return;

    const extracted = memoryDb.extractTextFromMessageJson(messageJson);
    if (!extracted || extracted.role !== 'assistant') return;
    if (!extracted.content || !extracted.content.trim()) return;

    if (wasMessageSummarized(threadId, messageId)) return;
    if (memorySummarizeInFlight.has(threadId)) return;
    memorySummarizeInFlight.add(threadId);

    try {
      const shortEntries = memoryDb.listShortMemory(threadId, 50);
      const summary = await generateLongMemorySummary(shortEntries);
      if (!summary) return;

      const normalizedSummary = summary.summary.trim().toLowerCase();
      const recentLong = memoryDb.listLongMemory(threadId, 10);
      if (
        recentLong.some(
          entry => entry.summary && entry.summary.trim().toLowerCase() === normalizedSummary
        )
      ) {
        return;
      }

      memoryDb.addLongMemory(
        {
          thread_id: threadId,
          summary: summary.summary,
          source_message_ids: summary.sourceMessageIds,
          metadata: {
            source: 'auto',
            model: summary.model,
            messageIds: summary.sourceMessageIds,
          },
        },
        { force: true }
      );
    } finally {
      memorySummarizeInFlight.delete(threadId);
    }
  };

  const queueEmotionAnalysis = (params: { threadId: string; messageId: string; messageJson: string }) => {
    const memoryConfig = getMemoryConfig();
    if (!memoryConfig?.enabled) return;

    const extracted = memoryDb.extractTextFromMessageJson(params.messageJson);
    if (!extracted || extracted.role !== 'user') return;

    const content = extracted.content.trim();
    if (!content) return;

    void (async () => {
      try {
        const emotion = await analyzeEmotionWithAgent(content);
        if (!emotion) return;
        memoryDb.addShortMemory({
          thread_id: params.threadId,
          message_id: params.messageId,
          role: extracted.role,
          content: extracted.content,
          emotion,
        });
      } catch (error) {
        console.warn(
          `[Emotion][Main] analysis failed message=${params.messageId}:`,
          getErrorMessage(error)
        );
      }
    })();
  };

  const injectMemoryIntoMessages = (
    messages: ChatInputMessage[],
    threadId?: string
  ): ChatInputMessage[] => {
    if (!threadId) return messages;
    const memoryConfig = getMemoryConfig();
    if (!memoryConfig?.enabled) return messages;

    const lastMessage = messages[messages.length - 1];
    const query = getPromptFromMessage(lastMessage);
    if (!query.trim()) return messages;

    const results = memoryDb.searchLongMemory(threadId, query, {
      limit: memoryConfig.maxRetrievalCount,
      threshold: memoryConfig.similarThreshold,
    });

    if (!results.length) return messages;
    const systemContent = buildMemorySystemMessage(results);
    if (!systemContent.trim()) return messages;

    const insertIndex = messages.findIndex(message => message.role !== 'system');
    const headIndex = insertIndex === -1 ? messages.length : insertIndex;
    const memoryMessage: ChatInputMessage = {
      role: 'system',
      content: systemContent,
    };

    return [...messages.slice(0, headIndex), memoryMessage, ...messages.slice(headIndex)];
  };

  const ensurePendingApprovalSession = (
    approvalId: string,
    session: { agent: SimpleAgent; webContents: ChatWebContents }
  ) => {
    const existing = pendingApprovalSessions.get(approvalId);
    if (existing) return existing;

    const created: PendingApprovalSession = {
      agent: session.agent,
      webContents: session.webContents,
      pendingApprovalIds: new Set([approvalId]),
      collectedApprovalResponses: new Map(),
    };
    pendingApprovalSessions.set(approvalId, created);
    return created;
  };

  const registerApprovalBatch = (
    approvalRequests: Array<{ approvalId: string }>,
    session: { agent: SimpleAgent; webContents: ChatWebContents }
  ) => {
    const approvalIds = approvalRequests
      .map(request => request.approvalId)
      .filter(id => typeof id === 'string' && id.length > 0);

    if (approvalIds.length === 0) return;

    const pendingSession: PendingApprovalSession = {
      agent: session.agent,
      webContents: session.webContents,
      pendingApprovalIds: new Set(approvalIds),
      collectedApprovalResponses: new Map(),
    };

    for (const approvalId of approvalIds) {
      pendingApprovalSessions.set(approvalId, pendingSession);
    }
  };

  const getPendingApprovalIdsFromUiMessage = (message: ChatUiMessage): string[] => {
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

  const getToolNameForApproval = (message: ChatUiMessage, approvalId: string): string | null => {
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
    const uiMessages = rows.map(row => parseStoredUiMessageRow({ id: row.id, message: row.message }));
    const inputMessages = injectMemoryIntoMessages(await toModelInputMessages(uiMessages), threadId);

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

    const agent = new SimpleAgent({
      enabled: true,
      providerType,
      model,
      systemPrompt: [TOOL_AGENT_SYSTEM_PROMPT, skillsSystemPrompt].filter(Boolean).join('\n\n'),
      enableTools: true,
      maxIterations: 5,
    });

    for (const name of toolNames) {
      const tool = defaultToolRegistry.get(name);
      if (tool) agent.registerTool(tool);
    }

    agent.setMessages(toAgentMessages(inputMessages));

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
      agent,
      webContents,
      pendingApprovalIds,
      collectedApprovalResponses: new Map(),
    };

    for (const id of pendingApprovalIds) {
      pendingApprovalSessions.set(id, session);
    }

    return session;
  };

  const streamAgentResponse = async (
    agent: SimpleAgent,
    webContents: ChatWebContents,
    prompt: string,
    approvalResponses?: ToolApprovalResponse[],
    shouldCancel?: () => boolean,
    debugLabel?: string,
    onToolEvent?: (event: ToolStreamEvent) => void,
    abortSignal?: AbortSignal,
    uiChunkEmitter?: UiChunkEmitter
  ) => {
    const generator = agent.stream(prompt, approvalResponses, onToolEvent, abortSignal);
    let fullResponse = '';
    let chunkCount = 0;
    let chunkChars = 0;
    const startedAt = Date.now();
    let cancelled = false;
    let next: IteratorResult<string, AgentResult> | null = null;

    try {
      next = await generator.next();
      while (!next.done) {
        if (shouldCancel?.()) {
          cancelled = true;
          try {
            await generator.return(undefined);
          } catch (error) {
            console.warn('[Main] Failed to close cancelled tool stream:', error);
          }
          break;
        }

        const chunk = next.value;
        if (typeof chunk === 'string' && chunk) {
          chunkCount += 1;
          chunkChars += chunk.length;
          if (debugLabel && shouldLogChunk(chunkCount)) {
            console.log(
              `[StreamDebug][Main][Agent][${debugLabel}] chunk#${chunkCount} len=${chunk.length} totalChars=${chunkChars}`
            );
          }
          fullResponse += chunk;
          uiChunkEmitter?.emitTextDelta(chunk);
        }
        next = await generator.next();
      }
    } catch (error) {
      if (shouldCancel?.() || (error instanceof Error && error.name === 'AbortError')) {
        cancelled = true;
        try {
          await generator.return(undefined);
        } catch (returnError) {
          console.warn('[Main] Failed to close aborted tool stream:', returnError);
        }
      } else {
        uiChunkEmitter?.error(getErrorMessage(error));
        throw error;
      }
    }

    if (cancelled || !next) {
      if (debugLabel) {
        console.log(
          `[StreamDebug][Main][Agent][${debugLabel}] cancelled chunkCount=${chunkCount} totalChars=${chunkChars} durationMs=${Date.now() - startedAt}`
        );
      }
      uiChunkEmitter?.abort();
      return { awaitingApproval: false, cancelled: true };
    }

    const agentResult = (next.value ?? null) as AgentResult | null;
    let finalText = fullResponse;
    if (agentResult?.response && agentResult.response.trim()) {
      finalText = agentResult.response;
    }

    if (agentResult?.toolApprovalRequests && agentResult.toolApprovalRequests.length > 0) {
      registerApprovalBatch(agentResult.toolApprovalRequests, { agent, webContents });
      return { awaitingApproval: true };
    }

    if (!finalText.trim() && fullResponse.trim()) {
      finalText = fullResponse;
    }

    if (debugLabel) {
      console.log(
        `[StreamDebug][Main][Agent][${debugLabel}] done chunkCount=${chunkCount} totalChars=${chunkChars} finalTextLen=${(finalText || '').length} durationMs=${Date.now() - startedAt}`
      );
    }
    uiChunkEmitter?.finish();
    return { awaitingApproval: false };
  };

  const getModels = async (providerType: string) => {
    try {
      // 1. Try provider-specific cache if it exists (e.g. for DeepSeek special logic)
      if (providerType === 'deepseek') return await deepseekProvider.getDeepSeekModels();
      if (providerType === 'openai') return await openaiProvider.getOpenAIModels();
      if (providerType === 'kimi') return await kimiProvider.getKimiModels();

      // 2. Fallback to general factory fetch
      return await llmFactory.fetchModelsFromDev(providerType);
    } catch (error: unknown) {
      console.error(`Failed to get models for ${providerType}:`, error);
      return [];
    }
  };

  const isProviderConfigured = (providerType: string) => {
    try {
      const config = llmFactory.getProviderConfig(providerType);
      return !!config.apiKey;
    } catch {
      return false;
    }
  };

  const stopStream = (senderId: number) => {
    const streamState = activeStreams.get(senderId);
    if (!streamState) {
      console.log(`[StreamDebug][Main][${senderId}] stop-stream ignored: no active stream`);
      return { success: false, error: 'No active stream' };
    }

    streamState.cancelled = true;
    streamState.stoppedByUser = true;
    streamState.abortController.abort('user-stop-request');
    console.log(`[StreamDebug][Main][${senderId}] stop-stream acknowledged`);
    return { success: true };
  };

  const send = async (options: {
    providerType: string;
    model: string;
    messages: ChatTransportMessage[];
    tools?: string[]; // Optional specific tools to enable
    skillIds?: string[]; // Optional skill ids to inject into system prompt
    skillMode?: 'manual' | 'auto';
    threadId?: string;
  }) => {
    try {
      const inputMessages = injectMemoryIntoMessages(
        await toModelInputMessages(options.messages),
        options.threadId
      );

      const skillMode = options.skillMode === 'auto' ? 'auto' : 'manual';
      const normalizedThreadId = typeof options.threadId === 'string' ? options.threadId.trim() : '';

      let pinnedSkillIds: string[] = [];
      if (normalizedThreadId) {
        try {
          const thread = chatThreadDb.getChatThread(normalizedThreadId);
          if (thread?.skill_ids) {
            pinnedSkillIds = normalizeSkillIds(JSON.parse(thread.skill_ids));
          }
        } catch (error) {
          console.warn('[Main] Failed to resolve skill_ids from thread:', error);
        }
      }

      let normalizedSkillIds = normalizeSkillIds(options.skillIds);

      if (skillMode === 'manual') {
        // Manual mode: use explicit skills if provided, otherwise fall back to pinned thread skills.
        if (normalizedSkillIds.length === 0 && !Array.isArray(options.skillIds)) {
          normalizedSkillIds = pinnedSkillIds;
        }

        // Persist explicit selection (including empty array to clear pinned skills).
        if (normalizedThreadId && Array.isArray(options.skillIds)) {
          try {
            chatThreadDb.updateChatThread(normalizedThreadId, {
              skill_ids: JSON.stringify(normalizedSkillIds),
            });
          } catch (error) {
            console.warn('[Main] Failed to persist skill_ids for thread:', error);
          }
        }
      } else {
        // Auto mode: pick relevant skills per message using tool model, plus pinned thread skills.
        const availableSkillCatalog = (await listSkills()).map(skill => ({
          id: skill.id,
          name: skill.name,
          description: skill.description,
          source: skill.source,
        }));

        const autoSelectedSkillIds = await selectSkillsWithAgent({
          messages: toLlmChatMessages(inputMessages),
          availableSkills: availableSkillCatalog,
        });

        if (autoSelectedSkillIds.length > 0) {
          console.log('[Main] Auto-selected skills:', autoSelectedSkillIds);
        }

        const union = new Set<string>();
        for (const id of pinnedSkillIds) union.add(id);
        for (const id of autoSelectedSkillIds) union.add(id);
        normalizedSkillIds = Array.from(union);
      }

      const skillsSystemPrompt =
        normalizedSkillIds.length > 0 ? await buildSkillsSystemPrompt(normalizedSkillIds) : '';

      if (options.tools && options.tools.length > 0) {
        // Use Agent if tools are specified
        const agent = new SimpleAgent({
          enabled: true,
          providerType: options.providerType,
          model: options.model,
          systemPrompt: [TOOL_AGENT_SYSTEM_PROMPT, skillsSystemPrompt].filter(Boolean).join('\n\n'), // Persona is already integrated in SimpleAgent
          enableTools: true,
          maxIterations: 5,
        });

        // Register selected tools
        for (const toolName of options.tools) {
          const tool = defaultToolRegistry.get(toolName);
          if (tool) agent.registerTool(tool);
        }

        // Separate user prompt from history
        const history = inputMessages.slice(0, -1);
        const lastMessage = inputMessages[inputMessages.length - 1];
        const prompt = getPromptFromMessage(lastMessage);

        if (!prompt.trim()) {
          throw new Error('No user prompt provided for tool-enabled chat');
        }

        agent.setMessages(toAgentMessages(history));
        const result = await agent.generate(prompt);
        return { success: true, text: result.response };
      }

      // Fallback to simple LLM call
      const text = await llmFactory.generateChat({
        providerType: options.providerType,
        modelId: options.model,
        messages: toLlmChatMessages(inputMessages),
        extraSystemPrompt: skillsSystemPrompt,
      });
      return { success: true, text };
    } catch (error: unknown) {
      return { success: false, error: getErrorMessage(error) };
    }
  };

  const stream = async (
    webContents: ChatWebContents,
    options: {
      providerType: string;
      model: string;
      messages: ChatTransportMessage[];
      tools?: string[];
      skillIds?: string[];
      skillMode?: 'manual' | 'auto';
      threadId?: string;
    }
  ) => {
    const senderId = webContents.id;
    const streamDebugId = `${senderId}-${Date.now()}`;
    const existingStream = activeStreams.get(senderId);
    if (existingStream) {
      existingStream.cancelled = true;
      existingStream.abortController.abort('superseded-by-new-request');
    }

    const streamState: ActiveStreamState = {
      cancelled: false,
      stoppedByUser: false,
      abortController: new AbortController(),
    };
    const uiChunkEmitter = createUiChunkEmitter(webContents);
    activeStreams.set(senderId, streamState);
    let partialResponse = '';
    let llmChunkCount = 0;
    const streamStartedAt = Date.now();
    console.log(
      `[StreamDebug][Main][${streamDebugId}] start provider=${options.providerType} model=${options.model} messageCount=${options.messages?.length ?? 0} toolCount=${options.tools?.length ?? 0}`
    );

    try {
      const inputMessages = injectMemoryIntoMessages(
        await toModelInputMessages(options.messages),
        options.threadId
      );

      const skillMode = options.skillMode === 'auto' ? 'auto' : 'manual';
      const normalizedThreadId = typeof options.threadId === 'string' ? options.threadId.trim() : '';

      let pinnedSkillIds: string[] = [];
      if (normalizedThreadId) {
        try {
          const thread = chatThreadDb.getChatThread(normalizedThreadId);
          if (thread?.skill_ids) {
            pinnedSkillIds = normalizeSkillIds(JSON.parse(thread.skill_ids));
          }
        } catch (error) {
          console.warn('[Main] Failed to resolve skill_ids from thread:', error);
        }
      }

      let normalizedSkillIds = normalizeSkillIds(options.skillIds);

      if (skillMode === 'manual') {
        if (normalizedSkillIds.length === 0 && !Array.isArray(options.skillIds)) {
          normalizedSkillIds = pinnedSkillIds;
        }

        if (normalizedThreadId && Array.isArray(options.skillIds)) {
          try {
            chatThreadDb.updateChatThread(normalizedThreadId, {
              skill_ids: JSON.stringify(normalizedSkillIds),
            });
          } catch (error) {
            console.warn('[Main] Failed to persist skill_ids for thread:', error);
          }
        }
      } else {
        const availableSkillCatalog = (await listSkills()).map(skill => ({
          id: skill.id,
          name: skill.name,
          description: skill.description,
          source: skill.source,
        }));

        const autoSelectedSkillIds = await selectSkillsWithAgent({
          messages: toLlmChatMessages(inputMessages),
          availableSkills: availableSkillCatalog,
        });

        if (autoSelectedSkillIds.length > 0) {
          console.log('[Main] Auto-selected skills:', autoSelectedSkillIds);
        }

        const union = new Set<string>();
        for (const id of pinnedSkillIds) union.add(id);
        for (const id of autoSelectedSkillIds) union.add(id);
        normalizedSkillIds = Array.from(union);
      }

      const skillsSystemPrompt =
        normalizedSkillIds.length > 0 ? await buildSkillsSystemPrompt(normalizedSkillIds) : '';

      const explicitTools = Array.isArray(options.tools)
        ? options.tools.filter(
            (toolName): toolName is string =>
              typeof toolName === 'string' && toolName.trim().length > 0
          )
        : [];

      let resolvedTools = explicitTools;

      if (resolvedTools.length === 0) {
        const availableTools = defaultToolRegistry
          .getToolMetadata()
          .map(t => ({ name: t.name, description: t.description }));
        resolvedTools = await selectToolsWithAgent({
          messages: toLlmChatMessages(inputMessages),
          availableTools,
        });
        if (resolvedTools.length > 0) {
          console.log('[Main] Auto-selected tools:', resolvedTools);
        }
      }

      if (normalizedThreadId) {
        try {
          const thread = chatThreadDb.getChatThread(normalizedThreadId);
          let parsedMetadata: unknown = {};
          try {
            parsedMetadata =
              thread?.metadata && thread.metadata.trim().length > 0
                ? JSON.parse(thread.metadata)
                : {};
          } catch {
            parsedMetadata = {};
          }

          const metadataRecord = isObjectRecord(parsedMetadata) ? parsedMetadata : {};
          const nextLlm = isObjectRecord(metadataRecord.llm) ? metadataRecord.llm : {};

          chatThreadDb.updateChatThread(normalizedThreadId, {
            model: options.model || thread?.model || null,
            tools: resolvedTools.length > 0 ? JSON.stringify(resolvedTools) : null,
            metadata: JSON.stringify({
              ...metadataRecord,
              llm: {
                ...(nextLlm as Record<string, unknown>),
                providerType: options.providerType,
                model: options.model,
                updatedAt: new Date().toISOString(),
              },
            }),
          } as any);
        } catch (error) {
          console.warn('[Main] Failed to persist thread runtime hints:', error);
        }
      }

      if (resolvedTools.length > 0) {
        const agent = new SimpleAgent({
          enabled: true,
          providerType: options.providerType,
          model: options.model,
          systemPrompt: [TOOL_AGENT_SYSTEM_PROMPT, skillsSystemPrompt].filter(Boolean).join('\n\n'),
          enableTools: true,
          maxIterations: 5,
        });

        console.log(
          '[Main] Streaming chat with tools:',
          resolvedTools,
          explicitTools.length > 0 ? '(manual)' : '(auto)'
        );

        for (const toolName of resolvedTools) {
          const tool = defaultToolRegistry.get(toolName);
          console.log(`[Main] Registering tool: ${toolName}`, tool ? 'found' : 'not found');
          if (tool) {
            agent.registerTool(tool);
          } else {
            console.warn(`[Main] Tool ${toolName} not found in registry`);
          }
        }

        console.log('[Main] Registered tools count:', agent.getTools().length);

        if (!inputMessages || inputMessages.length === 0) {
          throw new Error('No messages provided for streaming');
        }

        const history = inputMessages.slice(0, -1);
        const lastMessage = inputMessages[inputMessages.length - 1];
        const prompt = getPromptFromMessage(lastMessage);

        if (!prompt.trim()) {
          throw new Error('No user prompt provided for tool-enabled stream');
        }

        agent.setMessages(toAgentMessages(history));
        const streamResult = await streamAgentResponse(
          agent,
          webContents,
          prompt,
          undefined,
          () => streamState.cancelled,
          streamDebugId,
          eventPart => {
            if (
              eventPart.type === 'tool-approval-request' &&
              typeof eventPart.approvalId === 'string' &&
              eventPart.approvalId.length > 0
            ) {
              ensurePendingApprovalSession(eventPart.approvalId, { agent, webContents });
            }
            uiChunkEmitter.emitToolEvent(eventPart);
          },
          streamState.abortController.signal,
          uiChunkEmitter
        );
        console.log(
          `[StreamDebug][Main][${streamDebugId}] complete mode=agent stopped=${streamState.stoppedByUser} awaitingApproval=${streamResult.awaitingApproval ?? false} durationMs=${Date.now() - streamStartedAt}`
        );
        return {
          success: true,
          awaitingApproval: streamResult.awaitingApproval,
          stopped: streamState.stoppedByUser,
        };
      }

      const result = await llmFactory.streamChat(
        {
          providerType: options.providerType,
          modelId: options.model,
          messages: toLlmChatMessages(inputMessages),
          extraSystemPrompt: skillsSystemPrompt,
        },
        chunk => {
          if (streamState.cancelled) return;
          partialResponse += chunk;
          llmChunkCount += 1;
          if (shouldLogChunk(llmChunkCount)) {
            console.log(
              `[StreamDebug][Main][${streamDebugId}] chunk#${llmChunkCount} len=${chunk.length} totalChars=${partialResponse.length}`
            );
          }
          uiChunkEmitter.emitTextDelta(chunk);
        },
        () => streamState.cancelled,
        streamState.abortController.signal
      );
      const finalText = streamState.cancelled ? partialResponse : result;
      console.log(
        `[StreamDebug][Main][${streamDebugId}] complete mode=llm stopped=${streamState.stoppedByUser} chunkCount=${llmChunkCount} partialLen=${partialResponse.length} finalLen=${(finalText || '').length} durationMs=${Date.now() - streamStartedAt}`
      );
      if (streamState.cancelled) {
        uiChunkEmitter.abort();
      } else {
        uiChunkEmitter.finish();
      }
      return { success: true, stopped: streamState.stoppedByUser };
    } catch (error: unknown) {
      if (streamState.cancelled) {
        console.log(
          `[StreamDebug][Main][${streamDebugId}] cancelled-in-catch chunkCount=${llmChunkCount} partialLen=${partialResponse.length} durationMs=${Date.now() - streamStartedAt}`
        );
        uiChunkEmitter.abort();
        return { success: true, stopped: streamState.stoppedByUser };
      }
      const message = getErrorMessage(error);
      console.error(
        `[StreamDebug][Main][${streamDebugId}] error=${message} durationMs=${Date.now() - streamStartedAt}`
      );
      uiChunkEmitter.error(message);
      return { success: false, error: message };
    } finally {
      if (activeStreams.get(senderId) === streamState) {
        activeStreams.delete(senderId);
      }
    }
  };

  const approveTool = async (webContents: ChatWebContents, approvalId: string, approved: boolean) => {
    console.log(`[Main] Tool approval: ${approvalId}, approved: ${approved}`);

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
      console.log(
        `[Main] Tool approval pending batch completion: resolved=${session.collectedApprovalResponses.size} total=${session.pendingApprovalIds.size} waiting=${waitingForApprovals.join(',')}`
      );
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
    const existingStream = activeStreams.get(resumedSenderId);
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
    activeStreams.set(resumedSenderId, streamState);

    try {
      const streamResult = await streamAgentResponse(
        session.agent,
        session.webContents,
        '',
        Array.from(session.collectedApprovalResponses.values()),
        () => streamState.cancelled,
        undefined,
        eventPart => {
          if (
            eventPart.type === 'tool-approval-request' &&
            typeof eventPart.approvalId === 'string' &&
            eventPart.approvalId.length > 0
          ) {
            ensurePendingApprovalSession(eventPart.approvalId, {
              agent: session.agent,
              webContents: session.webContents,
            });
          }
          uiChunkEmitter.emitToolEvent(eventPart);
        },
        streamState.abortController.signal,
        uiChunkEmitter
      );
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
      if (activeStreams.get(resumedSenderId) === streamState) {
        activeStreams.delete(resumedSenderId);
      }
    }
  };

  const listThreads = () => chatThreadDb.getChatThreads();
  const getThread = (id: string) => chatThreadDb.getChatThread(id);
  const createThread = (thread: any) => {
    const threadId = thread.id || `thread_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const title = thread.title || 'New Chat';
    chatThreadDb.addChatThread({
      id: threadId,
      title,
      model: thread.model || null,
      metadata: thread.metadata || '{}',
      is_generating: false,
    });
    return chatThreadDb.getChatThread(threadId);
  };
  const updateThread = (id: string, thread: any) => chatThreadDb.updateChatThread(id, thread);
  const deleteThread = (id: string) => chatThreadDb.deleteChatThread(id);

  const listMessages = (threadId: string) => chatMessageDb.getChatMessages(threadId);
  const getMessage = (id: string) => chatMessageDb.getChatMessage(id);
  const createMessage = (message: any) => {
    const messageId = message.id || `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const timestamp = message.timestamp || new Date().toISOString();
    const sanitizedMessageJson =
      typeof message.message === 'string'
        ? sanitizeUiMessageJsonForStorage(message.message)
        : JSON.stringify(message.message ?? {});
    console.log(
      `[ChatPersist][Main] create-request id=${messageId} thread=${message.thread_id} parent=${message.parent_id || 'null'} depth=${message.depth || 0}`
    );

    try {
      chatMessageDb.addChatMessage({
        id: messageId,
        thread_id: message.thread_id,
        parent_id: message.parent_id || null,
        slot_id: message.slot_id || null,
        depth: message.depth || 0,
        message: sanitizedMessageJson,
        timestamp,
        metadata: message.metadata || '{}',
      });
    } catch (error: unknown) {
      const errorCode =
        typeof error === 'object' && error !== null && 'code' in error
          ? String((error as { code?: unknown }).code)
          : '';
      const errorMessage = getErrorMessage(error);

      if (
        errorCode === 'SQLITE_CONSTRAINT_PRIMARYKEY' ||
        errorMessage.includes('UNIQUE constraint failed: chat_messages.id')
      ) {
        console.warn(
          `[ChatPersist][Main] duplicate-create id=${messageId} thread=${message.thread_id} parent=${message.parent_id || 'null'}`
        );
        const existing = chatMessageDb.getChatMessage(messageId);
        if (existing) return existing;
      }

      console.error(
        `[ChatPersist][Main] create-failed id=${messageId} thread=${message.thread_id} code=${errorCode || 'unknown'} error=${errorMessage}`
      );
      throw error;
    }

    try {
      if (typeof sanitizedMessageJson === 'string') {
        const memoryConfig = getMemoryConfig();
        const forceShortMemory = Boolean(memoryConfig?.autoSummarize);
        memoryDb.addShortMemoryFromChatMessage(
          {
            thread_id: message.thread_id,
            message_id: messageId,
            message_json: sanitizedMessageJson,
          },
          forceShortMemory ? { force: true } : undefined
        );
        memoryDb.pruneShortMemory(message.thread_id);
        queueEmotionAnalysis({
          threadId: message.thread_id,
          messageId,
          messageJson: sanitizedMessageJson,
        });
        void maybeAutoSummarizeLongMemory(message.thread_id, messageId, sanitizedMessageJson);
      }
    } catch (error) {
      console.warn('[Memory][Main] short memory insert failed:', getErrorMessage(error));
    }

    const created = chatMessageDb.getChatMessage(messageId);
    console.log(
      `[ChatPersist][Main] create-success id=${messageId} thread=${message.thread_id} parent=${message.parent_id || 'null'}`
    );
    return created;
  };
  const updateMessage = (id: string, message: any) => {
    const sanitizedUpdate =
      message && typeof message === 'object' && message !== null
        ? {
            ...message,
            ...(typeof (message as { message?: unknown }).message === 'string'
              ? { message: sanitizeUiMessageJsonForStorage((message as { message: string }).message) }
              : {}),
          }
        : message;

    const result = chatMessageDb.updateChatMessage(id, sanitizedUpdate);
    try {
      const existing = chatMessageDb.getChatMessage(id);
      const threadId = sanitizedUpdate.thread_id || existing?.thread_id;
      const messageJson =
        typeof sanitizedUpdate.message === 'string' ? sanitizedUpdate.message : existing?.message;
      if (threadId && messageJson) {
        const memoryConfig = getMemoryConfig();
        const forceShortMemory = Boolean(memoryConfig?.autoSummarize);
        memoryDb.addShortMemoryFromChatMessage(
          {
            thread_id: threadId,
            message_id: id,
            message_json: messageJson,
          },
          forceShortMemory ? { force: true } : undefined
        );
        memoryDb.pruneShortMemory(threadId);
        queueEmotionAnalysis({
          threadId,
          messageId: id,
          messageJson,
        });
        void maybeAutoSummarizeLongMemory(threadId, id, messageJson);
      }
    } catch (error) {
      console.warn('[Memory][Main] short memory update failed:', getErrorMessage(error));
    }
    return result;
  };
  const deleteMessage = (id: string) => chatMessageDb.deleteChatMessage(id);

  return {
    // Chat threads
    listThreads,
    getThread,
    createThread,
    updateThread,
    deleteThread,
    // Chat messages
    listMessages,
    getMessage,
    createMessage,
    updateMessage,
    deleteMessage,
    // LLM integration
    getModels,
    isProviderConfigured,
    send,
    stream,
    stopStream,
    approveTool,
  };
};

export type ChatService = ReturnType<typeof createChatService>;

export const chatService: ChatService = createChatService();
