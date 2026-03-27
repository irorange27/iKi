import {
  createAffectSignalPart,
  createContextReportPart,
  createMemoryPart,
  createSkillUsagePart,
  getToolCallIdFromPart,
  getToolInput,
  getToolName,
  parseToolInputFromText,
} from './ui_message_tool_parts';
import type { ToolUiState, ToolUiStatePatch } from './tool_ui_state';
import {
  isAffectSignalPart,
  type ChatUiMessage,
  type ChatUiMessageChunk,
  isContextReportPart,
  isDynamicToolPart,
  isMemoryPart,
  isObjectRecord,
  isSkillUsagePart,
  isTextPart,
  type ContextReportItem,
  type DynamicToolPart,
  type SkillUsageEntry,
  type TextPart,
} from '../../../shared/chat/message_parts';
import { isAffectLabel, type AffectLabel } from '../../../shared/emotion/affect';

export type StreamState = {
  activeAssistantMessageId: string | null;
  activeAssistantParentId: string | null;
  activeStreamThreadId: string | null;
  streamingAssistantText: string;
  streamRenderTick: number;
};

export const createInitialStreamState = (): StreamState => ({
  activeAssistantMessageId: null,
  activeAssistantParentId: null,
  activeStreamThreadId: null,
  streamingAssistantText: '',
  streamRenderTick: 0,
});

export type StreamContext = {
  messages: ChatUiMessage[];
  createMessageId: () => string;
  currentThreadId: string | null;
  nowMs: number;
  toolUiStateMap: Readonly<Record<string, ToolUiState>>;
};

export type MessageOp =
  | { type: 'append'; message: ChatUiMessage }
  | { type: 'replace'; messageId: string; message: ChatUiMessage }
  | { type: 'remove'; messageId: string };

export type StreamEffect =
  | { type: 'scroll' }
  | {
      type: 'persist';
      message: ChatUiMessage;
      threadId: string;
      parentId?: string;
      source: string;
    }
  | { type: 'notify_persisted'; threadId: string; shouldNotify: boolean }
  | { type: 'tool_ui_state'; toolCallId: string; patch: ToolUiStatePatch }
  | {
      type: 'approval_request';
      payload: {
        approvalId: string;
        toolCallId: string;
        toolCall: { toolName: string; toolCallId: string; args: unknown };
      };
    }
  | { type: 'reset_approvals' };

export type StreamAction =
  | { type: 'begin_turn'; threadId: string; parentId: string }
  | { type: 'reset' }
  | { type: 'text_delta'; delta: string }
  | { type: 'finalize_response'; fullText: string }
  | { type: 'tool_chunk'; chunk: ChatUiMessageChunk }
  | {
      type: 'skill_chunk';
      chunk: { mode?: unknown; skills?: unknown };
    }
  | { type: 'memory_chunk'; chunk: { query?: unknown; results?: unknown } }
  | {
      type: 'affect_chunk';
      chunk: {
        source?: unknown;
        guardActive?: unknown;
        label?: unknown;
        confidence?: unknown;
        valence?: unknown;
        arousal?: unknown;
        emotions?: unknown;
        sampleCount?: unknown;
        windowSize?: unknown;
        startAt?: unknown;
        endAt?: unknown;
        ageMinutes?: unknown;
        windowMinutes?: unknown;
      };
    }
  | {
      type: 'context_chunk';
      chunk: {
        totalEstimatedTokens?: unknown;
        retainedRecentMessages?: unknown;
        compactedMessages?: unknown;
        blocks?: unknown;
      };
    };

export type ReduceResult = {
  state: StreamState;
  messageOps: MessageOp[];
  effects: StreamEffect[];
};

const resetTransientState = (state: StreamState): StreamState => ({
  ...state,
  activeAssistantMessageId: null,
  activeAssistantParentId: null,
  activeStreamThreadId: null,
  streamingAssistantText: '',
});

const updateAssistantMessage = (
  state: StreamState,
  ctx: StreamContext,
  build: (message: ChatUiMessage) => ChatUiMessage | null
): { state: StreamState; messageOps: MessageOp[]; updatedMessage?: ChatUiMessage } => {
  const messageId = state.activeAssistantMessageId;
  const existingIndex = messageId
    ? ctx.messages.findIndex(message => message.id === messageId)
    : -1;

  let baseMessage: ChatUiMessage;
  let nextState = state;
  const existed = existingIndex >= 0;

  if (existed) {
    baseMessage = ctx.messages[existingIndex] as ChatUiMessage;
  } else {
    baseMessage = {
      id: ctx.createMessageId(),
      role: 'assistant',
      parts: [],
    };
    nextState = {
      ...state,
      activeAssistantMessageId: baseMessage.id,
    };
  }

  const updated = build(baseMessage);
  const messageOps: MessageOp[] = [];

  if (updated) {
    messageOps.push({
      type: existed ? 'replace' : 'append',
      messageId: updated.id,
      message: updated,
    });
  } else if (existed) {
    messageOps.push({
      type: 'remove',
      messageId: baseMessage.id,
    });
  }

  return { state: nextState, messageOps, updatedMessage: updated ?? undefined };
};

const buildStreamingTextParts = (parts: UiMessagePart[], delta: string): UiMessagePart[] => {
  const nextParts = [...parts];
  const lastPart = nextParts[nextParts.length - 1];
  const shouldAppendToLast = isTextPart(lastPart) && lastPart.state === 'streaming';

  if (shouldAppendToLast) {
    const textPartIndex = nextParts.length - 1;
    const textPart = nextParts[textPartIndex] as TextPart;
    const previousText = textPart.text || '';
    nextParts[textPartIndex] = {
      ...textPart,
      text: `${previousText}${delta}`,
      state: 'streaming',
    };
  } else {
    const newPart: TextPart = {
      type: 'text',
      text: delta,
      state: 'streaming',
    };
    nextParts.push(newPart);
  }

  return nextParts;
};

const normalizeTextForToolDedup = (value: string): string => value.replace(/\s+/g, ' ').trim();

const isToolLikePart = (part: UiMessagePart): boolean => {
  if (isDynamicToolPart(part)) return true;
  return isObjectRecord(part) && typeof part.type === 'string' && part.type.startsWith('tool-');
};

const dedupeToolBridgedRepeatedTextParts = (parts: UiMessagePart[]): UiMessagePart[] => {
  if (parts.length < 3) return parts;

  const latestIndexByText = new Map<string, number>();
  const removedTextIndices = new Set<number>();

  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    if (!isTextPart(part)) continue;

    const normalizedText = normalizeTextForToolDedup(part.text);
    if (!normalizedText) continue;

    const previousIndex = latestIndexByText.get(normalizedText);
    if (previousIndex !== undefined && previousIndex < index) {
      const between = parts.slice(previousIndex + 1, index);
      const hasToolBetween = between.some(isToolLikePart);
      const hasMeaningfulTextBetween = between.some(
        entry => isTextPart(entry) && normalizeTextForToolDedup(entry.text).length > 0
      );

      if (hasToolBetween && !hasMeaningfulTextBetween) {
        removedTextIndices.add(previousIndex);
      }
    }

    latestIndexByText.set(normalizedText, index);
  }

  if (removedTextIndices.size === 0) return parts;

  return parts.filter((part, index) => !(removedTextIndices.has(index) && isTextPart(part)));
};

const finalizeTextParts = (
  parts: UiMessagePart[],
  fullText: string,
  streamedText: string
): { parts: UiMessagePart[]; hasStreamingTextPart: boolean; appendedText?: string } => {
  const nextParts = [...parts];
  const textPartIndices = nextParts
    .map((part, index) => ({ part, index }))
    .filter(({ part }) => isTextPart(part))
    .map(({ index }) => index);

  const existingTextPart =
    textPartIndices.length > 0
      ? (nextParts[textPartIndices[textPartIndices.length - 1]] as TextPart)
      : undefined;
  const existingStreamed = existingTextPart ? existingTextPart.text : '';

  const finalText = fullText.length > 0 ? fullText : streamedText || existingStreamed;
  let hasStreamingTextPart = false;

  for (const index of textPartIndices) {
    const part = nextParts[index] as TextPart;
    if (part.state === 'streaming') {
      hasStreamingTextPart = true;
      nextParts[index] = {
        ...part,
        state: 'done',
      };
    }
  }

  if (textPartIndices.length === 0 && finalText) {
    const newPart: TextPart = {
      type: 'text',
      text: finalText,
      state: 'done',
    };
    nextParts.push(newPart);
    return { parts: nextParts, hasStreamingTextPart, appendedText: finalText };
  }

  if (!hasStreamingTextPart && finalText && !existingStreamed) {
    const newPart: TextPart = {
      type: 'text',
      text: finalText,
      state: 'done',
    };
    nextParts.push(newPart);
    return { parts: nextParts, hasStreamingTextPart, appendedText: finalText };
  }

  return { parts: nextParts, hasStreamingTextPart };
};

const hasRenderableContent = (parts: UiMessagePart[]): boolean =>
  parts.some(part => (isTextPart(part) ? part.text.trim().length > 0 : true));

const buildToolPartUpdate = (
  part: DynamicToolPart,
  chunk: ChatUiMessageChunk,
  inputText?: string
): DynamicToolPart => {
  const nextPart = { ...part };

  if ('providerExecuted' in chunk && typeof chunk.providerExecuted === 'boolean') {
    nextPart.providerExecuted = chunk.providerExecuted;
  }
  if ('title' in chunk && typeof chunk.title === 'string') {
    nextPart.title = chunk.title;
  }

  if (chunk.type === 'tool-input-start') {
    nextPart.state = 'input-streaming';
    if (nextPart.input === undefined) {
      nextPart.input = {};
    }
    return nextPart;
  }

  if (chunk.type === 'tool-input-delta') {
    const nextInputText = typeof inputText === 'string' ? inputText : '';
    nextPart.input = parseToolInputFromText(nextInputText);
    nextPart.state = 'input-streaming';
    return nextPart;
  }

  if (chunk.type === 'tool-input-available') {
    if (isObjectRecord(nextPart.input) && isObjectRecord(chunk.input)) {
      nextPart.input = { ...nextPart.input, ...chunk.input };
    } else {
      nextPart.input = chunk.input ?? nextPart.input ?? {};
    }
    nextPart.state = 'input-available';
    return nextPart;
  }

  if (chunk.type === 'tool-input-error') {
    if (isObjectRecord(nextPart.input) && isObjectRecord(chunk.input)) {
      nextPart.input = { ...nextPart.input, ...chunk.input };
    } else {
      nextPart.input = chunk.input ?? nextPart.input ?? {};
    }
    nextPart.output = {
      error: chunk.errorText || 'Invalid tool input',
    };
    nextPart.state = 'output-error';
    return nextPart;
  }

  if (chunk.type === 'tool-output-available') {
    nextPart.output = chunk.output;
    nextPart.state = chunk.preliminary ? 'input-streaming' : 'output-available';
    return nextPart;
  }

  if (chunk.type === 'tool-output-error') {
    nextPart.output = {
      error: chunk.errorText || 'Tool execution failed',
    };
    nextPart.state = 'output-error';
    return nextPart;
  }

  if (chunk.type === 'tool-output-denied') {
    nextPart.state = 'output-denied';
    nextPart.output = {
      message: 'Tool execution denied',
      toolCallId: nextPart.toolCallId,
    };
    return nextPart;
  }

  return nextPart;
};

const buildToolUiStatePatch = (
  chunk: ChatUiMessageChunk,
  nowMs: number,
  previousState: ToolUiState | undefined,
  nextInputText?: string
): ToolUiStatePatch => {
  const patch: ToolUiStatePatch = {};
  const startedAt =
    typeof previousState?.startedAt === 'number' && Number.isFinite(previousState.startedAt)
      ? previousState.startedAt
      : undefined;

  const ensureStartedAt = () => {
    if (startedAt === undefined && patch.startedAt === undefined) {
      patch.startedAt = nowMs;
    }
  };

  const finalizeDuration = () => {
    const resolvedStart = startedAt ?? nowMs;
    if (startedAt === undefined) {
      patch.startedAt = resolvedStart;
    }
    patch.endedAt = nowMs;
    patch.durationMs = Math.max(0, nowMs - resolvedStart);
  };

  const clearInputText = () => {
    if (previousState?.inputText !== undefined) {
      patch.inputText = undefined;
    }
  };

  if (chunk.type === 'tool-input-start') {
    ensureStartedAt();
    if (typeof previousState?.inputText !== 'string' || previousState.inputText.length > 0) {
      patch.inputText = '';
    }
    return patch;
  }

  if (chunk.type === 'tool-input-delta') {
    ensureStartedAt();
    patch.inputText = typeof nextInputText === 'string' ? nextInputText : '';
    return patch;
  }

  if (chunk.type === 'tool-input-available') {
    clearInputText();
    return patch;
  }

  if (chunk.type === 'tool-input-error') {
    finalizeDuration();
    clearInputText();
    return patch;
  }

  if (chunk.type === 'tool-output-available') {
    clearInputText();
    if (!chunk.preliminary) {
      finalizeDuration();
      if (typeof previousState?.collapsed !== 'boolean') {
        patch.collapsed = true;
      }
    }
    return patch;
  }

  if (chunk.type === 'tool-output-error') {
    finalizeDuration();
    clearInputText();
    return patch;
  }

  if (chunk.type === 'tool-output-denied') {
    finalizeDuration();
    clearInputText();
    return patch;
  }

  return patch;
};

export const reduceStream = (
  state: StreamState,
  ctx: StreamContext,
  action: StreamAction
): ReduceResult => {
  if (action.type === 'begin_turn') {
    const nextState: StreamState = {
      ...state,
      activeAssistantParentId: action.parentId,
      activeAssistantMessageId: null,
      activeStreamThreadId: action.threadId,
      streamingAssistantText: '',
    };

    return {
      state: nextState,
      messageOps: [],
      effects: [{ type: 'reset_approvals' }],
    };
  }

  if (action.type === 'reset') {
    return {
      state: resetTransientState(state),
      messageOps: [],
      effects: [{ type: 'reset_approvals' }],
    };
  }

  if (action.type === 'text_delta') {
    const nextState: StreamState = {
      ...state,
      streamRenderTick: state.streamRenderTick + 1,
      streamingAssistantText: `${state.streamingAssistantText}${action.delta}`,
    };

    const updateResult = updateAssistantMessage(nextState, ctx, message => {
      const nextParts = buildStreamingTextParts(message.parts, action.delta);
      return {
        ...message,
        parts: nextParts,
      };
    });

    const effects: StreamEffect[] = [{ type: 'scroll' }];

    return {
      state: updateResult.state,
      messageOps: updateResult.messageOps,
      effects,
    };
  }

  if (action.type === 'finalize_response') {
    const nextStateBase: StreamState = {
      ...state,
      streamRenderTick: state.streamRenderTick + 1,
    };
    const responseThreadId = state.activeStreamThreadId || ctx.currentThreadId || '';
    if (!responseThreadId) {
      return {
        state: nextStateBase,
        messageOps: [],
        effects: [],
      };
    }

    const existingIndex = state.activeAssistantMessageId
      ? ctx.messages.findIndex(message => message.id === state.activeAssistantMessageId)
      : -1;

    if (existingIndex < 0 && !action.fullText.trim()) {
      return {
        state: resetTransientState(nextStateBase),
        messageOps: [],
        effects: [{ type: 'reset_approvals' }],
      };
    }

    const updateResult = updateAssistantMessage(nextStateBase, ctx, message => {
      const streamedText = state.streamingAssistantText;
      const finalizeResult = finalizeTextParts(message.parts, action.fullText, streamedText);
      const dedupedParts = dedupeToolBridgedRepeatedTextParts(finalizeResult.parts);

      const updatedMessage: ChatUiMessage = {
        ...message,
        parts: dedupedParts,
      };

      if (!hasRenderableContent(dedupedParts)) {
        return null;
      }

      return updatedMessage;
    });

    const updatedMessage = updateResult.updatedMessage;
    if (!updatedMessage) {
      return {
        state: resetTransientState(updateResult.state),
        messageOps: updateResult.messageOps,
        effects: [{ type: 'reset_approvals' }, { type: 'scroll' }],
      };
    }

    const effects: StreamEffect[] = [
      {
        type: 'persist',
        message: updatedMessage,
        parentId: updateResult.state.activeAssistantParentId || undefined,
        source: 'assistant-response',
        threadId: responseThreadId,
      },
      {
        type: 'notify_persisted',
        threadId: responseThreadId,
        shouldNotify: ctx.currentThreadId === responseThreadId,
      },
      { type: 'reset_approvals' },
      { type: 'scroll' },
    ];

    return {
      state: resetTransientState(updateResult.state),
      messageOps: updateResult.messageOps,
      effects,
    };
  }

  if (action.type === 'tool_chunk') {
    const chunk = action.chunk;
    if (chunk.type === 'tool-approval-request') {
      const existingMessage = state.activeAssistantMessageId
        ? ctx.messages.find(message => message.id === state.activeAssistantMessageId)
        : undefined;
      const existingPart = existingMessage?.parts.find(
        part => getToolCallIdFromPart(part) === chunk.toolCallId
      );
      const existingToolName = getToolName(existingPart);
      const existingInput = getToolInput(existingPart) ?? {};

      const effects: StreamEffect[] = [
        {
          type: 'approval_request',
          payload: {
            approvalId: chunk.approvalId,
            toolCallId: chunk.toolCallId,
            toolCall: {
              toolName: existingToolName,
              toolCallId: chunk.toolCallId,
              args: existingInput,
            },
          },
        },
      ];

      const existingUiState = ctx.toolUiStateMap[chunk.toolCallId];
      if (
        !existingUiState ||
        typeof existingUiState.startedAt !== 'number' ||
        !Number.isFinite(existingUiState.startedAt)
      ) {
        effects.unshift({
          type: 'tool_ui_state',
          toolCallId: chunk.toolCallId,
          patch: { startedAt: ctx.nowMs },
        });
      }

      return {
        state,
        messageOps: [],
        effects,
      };
    }

    const toolCallId = chunk.toolCallId;
    const previousUiState = toolCallId ? ctx.toolUiStateMap[toolCallId] : undefined;
    let nextInputText: string | undefined;
    if (chunk.type === 'tool-input-delta') {
      const delta = typeof chunk.inputTextDelta === 'string' ? chunk.inputTextDelta : '';
      const previousInputText =
        typeof previousUiState?.inputText === 'string' ? previousUiState.inputText : '';
      nextInputText = `${previousInputText}${delta}`;
    }

    const updateResult = updateAssistantMessage(state, ctx, message => {
      const nextParts = [...message.parts];
      for (let i = 0; i < nextParts.length; i += 1) {
        const part = nextParts[i];
        if (!isTextPart(part) || part.state !== 'streaming') continue;
        nextParts[i] = {
          ...part,
          state: 'done',
        };
      }

      const existingPartIndex = nextParts.findIndex(
        part => getToolCallIdFromPart(part) === toolCallId
      );
      const existingPart = existingPartIndex >= 0 ? nextParts[existingPartIndex] : undefined;
      const existingToolPart = isDynamicToolPart(existingPart) ? existingPart : undefined;
      const chunkToolName =
        'toolName' in chunk && typeof chunk.toolName === 'string' && chunk.toolName.trim()
          ? chunk.toolName
          : undefined;

      const nextPart: DynamicToolPart = {
        ...(existingToolPart || {}),
        type: 'dynamic-tool',
        toolCallId,
        toolName: chunkToolName || (existingToolPart ? existingToolPart.toolName : 'tool'),
      };

      const updatedPart = buildToolPartUpdate(nextPart, chunk, nextInputText);

      if (existingPartIndex >= 0) {
        nextParts[existingPartIndex] = updatedPart;
      } else {
        nextParts.push(updatedPart);
      }

      return {
        ...message,
        parts: nextParts,
      };
    });

    const effects: StreamEffect[] = [{ type: 'scroll' }];
    const uiPatch = buildToolUiStatePatch(chunk, ctx.nowMs, previousUiState, nextInputText);
    if (toolCallId && Object.keys(uiPatch).length > 0) {
      effects.unshift({
        type: 'tool_ui_state',
        toolCallId,
        patch: uiPatch,
      });
    }
    if (
      chunk.type === 'tool-input-available' ||
      chunk.type === 'tool-input-error' ||
      chunk.type === 'tool-output-available' ||
      chunk.type === 'tool-output-error' ||
      chunk.type === 'tool-output-denied'
    ) {
      const threadId = state.activeStreamThreadId || ctx.currentThreadId || '';
      if (threadId && updateResult.updatedMessage) {
        effects.unshift({
          type: 'persist',
          message: updateResult.updatedMessage,
          parentId: state.activeAssistantParentId || undefined,
          source: `tool-ui-chunk:${chunk.type}`,
          threadId,
        });
      }
    }

    return {
      state: updateResult.state,
      messageOps: updateResult.messageOps,
      effects,
    };
  }

  if (action.type === 'memory_chunk') {
    const results = Array.isArray(action.chunk.results)
      ? action.chunk.results.filter(
          entry => isObjectRecord(entry) && typeof entry.summary === 'string'
        )
      : [];

    const updateResult = updateAssistantMessage(state, ctx, message => {
      const nextParts = [...message.parts];
      const existingIndex = nextParts.findIndex(part => isMemoryPart(part));

      const memoryPart = createMemoryPart({
        query: typeof action.chunk.query === 'string' ? action.chunk.query : '',
        results,
      });

      if (existingIndex >= 0) {
        nextParts[existingIndex] = memoryPart;
      } else {
        nextParts.unshift(memoryPart);
      }

      return {
        ...message,
        parts: nextParts,
      };
    });

    return {
      state: updateResult.state,
      messageOps: updateResult.messageOps,
      effects: [{ type: 'scroll' }],
    };
  }

  if (action.type === 'skill_chunk') {
    const skills = Array.isArray(action.chunk.skills)
      ? action.chunk.skills
          .filter(
            (entry): entry is SkillUsageEntry =>
              isObjectRecord(entry) &&
              typeof entry.id === 'string' &&
              entry.id.trim().length > 0 &&
              typeof entry.name === 'string' &&
              entry.name.trim().length > 0
          )
          .map(entry => ({
            id: entry.id.trim(),
            name: entry.name.trim(),
            ...(typeof entry.description === 'string' && entry.description.trim()
              ? { description: entry.description.trim() }
              : {}),
            ...(entry.source === 'user' || entry.source === 'codex'
              ? { source: entry.source }
              : {}),
          }))
      : [];

    if (skills.length === 0) {
      return { state, messageOps: [], effects: [] };
    }

    const updateResult = updateAssistantMessage(state, ctx, message => {
      const nextParts = [...message.parts];
      const existingIndex = nextParts.findIndex(part => isSkillUsagePart(part));

      const skillPart = createSkillUsagePart({
        mode: action.chunk.mode === 'auto' ? 'auto' : 'manual',
        skills,
      });

      if (existingIndex >= 0) {
        nextParts[existingIndex] = skillPart;
      } else {
        nextParts.unshift(skillPart);
      }

      return {
        ...message,
        parts: nextParts,
      };
    });

    return {
      state: updateResult.state,
      messageOps: updateResult.messageOps,
      effects: [{ type: 'scroll' }],
    };
  }

  if (action.type === 'affect_chunk') {
    if (!isAffectLabel(action.chunk.label)) {
      return { state, messageOps: [], effects: [] };
    }
    const label = action.chunk.label;

    const emotions = Array.isArray(action.chunk.emotions)
      ? action.chunk.emotions
          .filter(
            (entry): entry is { label: AffectLabel; score: number } =>
              isObjectRecord(entry) &&
              isAffectLabel(entry.label) &&
              typeof entry.score === 'number' &&
              Number.isFinite(entry.score)
          )
          .map(entry => ({
            label: entry.label,
            score: Math.min(1, Math.max(0, entry.score)),
          }))
      : [];

    const updateResult = updateAssistantMessage(state, ctx, message => {
      const nextParts = [...message.parts];
      const existingIndex = nextParts.findIndex(part => isAffectSignalPart(part));

      const affectPart = createAffectSignalPart({
        label,
        ...(action.chunk.source === 'history' || action.chunk.source === 'realtime'
          ? { source: action.chunk.source }
          : {}),
        ...(typeof action.chunk.guardActive === 'boolean'
          ? { guardActive: action.chunk.guardActive }
          : {}),
        ...(typeof action.chunk.confidence === 'number' &&
        Number.isFinite(action.chunk.confidence)
          ? { confidence: Math.min(1, Math.max(0, action.chunk.confidence)) }
          : {}),
        ...(typeof action.chunk.valence === 'number' && Number.isFinite(action.chunk.valence)
          ? { valence: Math.min(1, Math.max(-1, action.chunk.valence)) }
          : {}),
        ...(typeof action.chunk.arousal === 'number' && Number.isFinite(action.chunk.arousal)
          ? { arousal: Math.min(1, Math.max(0, action.chunk.arousal)) }
          : {}),
        ...(emotions.length > 0 ? { emotions } : {}),
        ...(typeof action.chunk.sampleCount === 'number' && Number.isFinite(action.chunk.sampleCount)
          ? { sampleCount: Math.max(0, Math.trunc(action.chunk.sampleCount)) }
          : {}),
        ...(typeof action.chunk.windowSize === 'number' && Number.isFinite(action.chunk.windowSize)
          ? { windowSize: Math.max(0, Math.trunc(action.chunk.windowSize)) }
          : {}),
        ...(typeof action.chunk.startAt === 'string' ? { startAt: action.chunk.startAt } : {}),
        ...(typeof action.chunk.endAt === 'string' ? { endAt: action.chunk.endAt } : {}),
        ...(typeof action.chunk.ageMinutes === 'number' && Number.isFinite(action.chunk.ageMinutes)
          ? { ageMinutes: Math.max(0, action.chunk.ageMinutes) }
          : {}),
        ...(typeof action.chunk.windowMinutes === 'number' &&
        Number.isFinite(action.chunk.windowMinutes)
          ? { windowMinutes: Math.max(0, action.chunk.windowMinutes) }
          : {}),
      });

      if (existingIndex >= 0) {
        nextParts[existingIndex] = affectPart;
      } else {
        nextParts.unshift(affectPart);
      }

      return {
        ...message,
        parts: nextParts,
      };
    });

    return {
      state: updateResult.state,
      messageOps: updateResult.messageOps,
      effects: [{ type: 'scroll' }],
    };
  }

  if (action.type === 'context_chunk') {
    const blocks = Array.isArray(action.chunk.blocks)
      ? action.chunk.blocks
          .filter(
            (entry): entry is ContextReportItem =>
              isObjectRecord(entry) &&
              typeof entry.kind === 'string' &&
              typeof entry.status === 'string'
          )
          .map(entry => ({
            kind: entry.kind,
            status: entry.status,
            ...(typeof entry.estimatedTokens === 'number' && Number.isFinite(entry.estimatedTokens)
              ? { estimatedTokens: Math.max(0, Math.trunc(entry.estimatedTokens)) }
              : {}),
            ...(typeof entry.charCount === 'number' && Number.isFinite(entry.charCount)
              ? { charCount: Math.max(0, Math.trunc(entry.charCount)) }
              : {}),
            ...(typeof entry.reason === 'string' && entry.reason.trim()
              ? { reason: entry.reason.trim() }
              : {}),
            ...(typeof entry.sourceCount === 'number' && Number.isFinite(entry.sourceCount)
              ? { sourceCount: Math.max(0, Math.trunc(entry.sourceCount)) }
              : {}),
          }))
      : [];

    const updateResult = updateAssistantMessage(state, ctx, message => {
      const nextParts = [...message.parts];
      const existingIndex = nextParts.findIndex(part => isContextReportPart(part));

      const contextPart = createContextReportPart({
        ...(typeof action.chunk.totalEstimatedTokens === 'number' &&
        Number.isFinite(action.chunk.totalEstimatedTokens)
          ? { totalEstimatedTokens: Math.max(0, Math.trunc(action.chunk.totalEstimatedTokens)) }
          : {}),
        ...(typeof action.chunk.retainedRecentMessages === 'number' &&
        Number.isFinite(action.chunk.retainedRecentMessages)
          ? { retainedRecentMessages: Math.max(0, Math.trunc(action.chunk.retainedRecentMessages)) }
          : {}),
        ...(typeof action.chunk.compactedMessages === 'number' &&
        Number.isFinite(action.chunk.compactedMessages)
          ? { compactedMessages: Math.max(0, Math.trunc(action.chunk.compactedMessages)) }
          : {}),
        blocks,
      });

      if (existingIndex >= 0) {
        nextParts[existingIndex] = contextPart;
      } else {
        nextParts.unshift(contextPart);
      }

      return {
        ...message,
        parts: nextParts,
      };
    });

    return {
      state: updateResult.state,
      messageOps: updateResult.messageOps,
      effects: [{ type: 'scroll' }],
    };
  }

  return { state, messageOps: [], effects: [] };
};
