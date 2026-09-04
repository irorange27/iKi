import { defaultToolRegistry } from '@iki/backend/tools';
import type {
  AffectSignalPartData,
  ChatUiMessageChunk,
  SkillUsageEntry,
  TokenUsagePartData,
} from '@iki/backend/chat/message_parts';
import type { AffectSignal } from '@iki/backend/types/affect';
import { isObjectRecord } from '@iki/backend/chat/tool_parts';

import type { ChatStreamTarget, ChatStreamEvent, UiChunkEmitter } from './types';
import { createPrefixedId } from '@iki/backend/utils/id';

const getNestedToolEventField = (
  event: ChatStreamEvent,
  field: 'toolCallId' | 'toolName'
): unknown => {
  if (field in event) {
    const value = event[field];
    if (typeof value === 'string' && value.length > 0) return value;
    // Empty or non-string value shadows nested toolCall — fall through.
  }
  const nestedToolCall = event.toolCall;
  if (!isObjectRecord(nestedToolCall)) return undefined;
  return nestedToolCall[field];
};

const getToolCallIdFromEvent = (event: ChatStreamEvent): string => {
  const candidate =
    typeof getNestedToolEventField(event, 'toolCallId') === 'string'
      ? (getNestedToolEventField(event, 'toolCallId') as string)
      : typeof event.id === 'string'
        ? event.id
        : '';

  if (candidate.length > 0) return candidate;
  return createPrefixedId('tool_call');
};

const getToolNameFromEvent = (event: ChatStreamEvent): string =>
  typeof getNestedToolEventField(event, 'toolName') === 'string' &&
  (getNestedToolEventField(event, 'toolName') as string).length > 0
    ? (getNestedToolEventField(event, 'toolName') as string)
    : 'tool';

const getToolDisplayTitle = (toolName: string): string | undefined => {
  const tool = defaultToolRegistry.get(toolName);
  if (tool) {
    const baseName =
      typeof tool.displayName === 'string' && tool.displayName.trim()
        ? tool.displayName.trim()
        : tool.name;
    return baseName;
  }
  if (toolName.startsWith('mcp:')) {
    const slashIndex = toolName.lastIndexOf('/');
    if (slashIndex >= 0 && slashIndex < toolName.length - 1) {
      return toolName.slice(slashIndex + 1);
    }
  }
  const mcpMatch = toolName.match(/^mcp_[a-f0-9]{8}_(.+)$/);
  if (mcpMatch && mcpMatch[1]) {
    return mcpMatch[1];
  }
  return undefined;
};

const toUiChunkFromToolEvent = (event: ChatStreamEvent): ChatUiMessageChunk | null => {
  const toolCallId = getToolCallIdFromEvent(event);
  const toolName = getToolNameFromEvent(event);
  const title = getToolDisplayTitle(toolName);

  if (event.type === 'tool-input-start') {
    return {
      type: 'tool-input-start',
      toolCallId,
      toolName,
      ...(title ? { title } : {}),
      dynamic: true,
    };
  }
  if (event.type === 'tool-input-delta') {
    return {
      type: 'tool-input-delta',
      toolCallId,
      inputTextDelta: typeof event.delta === 'string' ? event.delta : '',
    };
  }
  if (event.type === 'tool-input-end') {
    return null;
  }
  if (event.type === 'tool-call') {
    if (event.invalid) {
      return {
        type: 'tool-input-error',
        toolCallId,
        toolName,
        input: event.input ?? {},
        errorText:
          typeof event.error === 'string'
            ? event.error
            : event.error instanceof Error
              ? event.error.message
              : 'Invalid tool call',
        ...(title ? { title } : {}),
        dynamic: true,
      };
    }
    return {
      type: 'tool-input-available',
      toolCallId,
      toolName,
      input: event.input ?? {},
      ...(title ? { title } : {}),
      dynamic: true,
    };
  }
  if (event.type === 'tool-result') {
    return {
      type: 'tool-output-available',
      toolCallId,
      output: event.output,
      dynamic: true,
      ...(typeof event.preliminary === 'boolean' ? { preliminary: event.preliminary } : {}),
    };
  }
  if (event.type === 'tool-error') {
    return {
      type: 'tool-output-error',
      toolCallId,
      errorText:
        typeof event.error === 'string'
          ? event.error
          : event.error instanceof Error
            ? event.error.message
            : 'Tool execution failed',
      dynamic: true,
    };
  }
  if (event.type === 'tool-output-denied') {
    return {
      type: 'tool-output-denied',
      toolCallId,
    };
  }
  if (event.type === 'tool-approval-request') {
    const approvalInput = isObjectRecord(event.toolCall)
      ? (isObjectRecord(event.toolCall.args) ? event.toolCall.args : event.toolCall.input)
      : undefined;

    return {
      type: 'tool-approval-request',
      approvalId:
        typeof event.approvalId === 'string' && event.approvalId.length > 0
          ? event.approvalId
          : createPrefixedId('approval'),
      toolCallId,
      ...(toolName !== 'tool' ? { toolName } : {}),
      ...(approvalInput !== undefined ? { input: approvalInput } : {}),
    };
  }

  return null;
};

export const createUiChunkEmitter = (
  target: ChatStreamTarget,
  messageId: string = createPrefixedId('assistant')
): UiChunkEmitter => {
  let started = false;
  let textStarted = false;
  let terminated = false;
  let textSegmentIndex = 0;
  // Tool call ids that already have a tool part on the wire. The AI SDK
  // stream processor attaches outputs/errors/denials/approvals onto an
  // existing tool part and fails otherwise — the old hand-rolled renderer
  // created parts on demand instead, so keep that tolerance here.
  const seededToolCallIds = new Set<string>();

  const emitChunk = (
    chunk: ChatUiMessageChunk
  ) => {
    target.send('chat:ui-chunk', chunk);
  };

  const ensureStarted = () => {
    if (started || terminated) return;
    emitChunk({ type: 'start', messageId });
    started = true;
  };

  // Text is segmented around tool events so the SDK's id-keyed accumulation
  // renders a multi-step turn interleaved (text → tool → text) instead of
  // merging every segment into the first text part.
  const getTextSegmentId = (index: number): string => `${messageId}-t${index}`;

  const ensureTextStarted = () => {
    ensureStarted();
    if (terminated) return;
    if (!textStarted) {
      emitChunk({ type: 'text-start', id: getTextSegmentId(textSegmentIndex) });
      textStarted = true;
    }
  };

  const closeText = () => {
    if (!textStarted || terminated) return;
    emitChunk({ type: 'text-end', id: getTextSegmentId(textSegmentIndex) });
    textStarted = false;
    textSegmentIndex += 1;
  };

  const ensureToolPartSeeded = (toolCallId: string, toolName: string, input: unknown) => {
    if (seededToolCallIds.has(toolCallId)) return;
    const title = getToolDisplayTitle(toolName);
    emitChunk({
      type: 'tool-input-available',
      toolCallId,
      toolName,
      input,
      dynamic: true,
      ...(title ? { title } : {}),
    });
    seededToolCallIds.add(toolCallId);
  };

  return {
    messageId,
    emitTextDelta: delta => {
      if (!delta || terminated) return;
      ensureTextStarted();
      emitChunk({ type: 'text-delta', id: getTextSegmentId(textSegmentIndex), delta });
    },
    emitToolEvent: event => {
      if (terminated) return;
      ensureStarted();
      closeText();
      const toolCallId = getToolCallIdFromEvent(event);
      if (
        event.type === 'tool-result' ||
        event.type === 'tool-error' ||
        event.type === 'tool-output-denied' ||
        event.type === 'tool-approval-request'
      ) {
        const toolName = getToolNameFromEvent(event);
        const input = isObjectRecord(event.toolCall)
          ? (isObjectRecord(event.toolCall.args) ? event.toolCall.args : event.toolCall.input)
          : undefined;
        ensureToolPartSeeded(toolCallId, toolName, input ?? {});
      }
      const uiChunk = toUiChunkFromToolEvent(event);
      if (uiChunk) {
        if (uiChunk.type === 'tool-input-start' || uiChunk.type === 'tool-input-available') {
          seededToolCallIds.add(uiChunk.toolCallId);
        }
        emitChunk(uiChunk);
      }
    },
    emitSkillUsage: (payload: { mode?: 'manual' | 'auto'; skills: SkillUsageEntry[] }) => {
      if (terminated) return;
      ensureStarted();
      emitChunk({
        type: 'data-skill-usage',
        id: 'skill-usage',
        data: {
          ...(payload.mode === 'auto' || payload.mode === 'manual' ? { mode: payload.mode } : {}),
          skills: Array.isArray(payload.skills) ? payload.skills : [],
        },
      });
    },
    emitMemoryRetrieval: payload => {
      if (terminated) return;
      ensureStarted();
      emitChunk({
        type: 'data-memory-retrieval',
        id: 'memory-retrieval',
        data: {
          query: payload?.query ?? '',
          results: Array.isArray(payload?.results) ? payload.results : [],
        },
      });
    },
    emitAffectSignal: (payload: AffectSignal) => {
      if (terminated) return;
      ensureStarted();
      const data: AffectSignalPartData = {
        source: payload.source,
        guardActive: payload.guardActive,
        label: payload.state.label,
        confidence: payload.state.confidence,
        ...(typeof payload.state.valence === 'number' ? { valence: payload.state.valence } : {}),
        ...(typeof payload.state.arousal === 'number' ? { arousal: payload.state.arousal } : {}),
        ...(payload.state.emotions ? { emotions: payload.state.emotions } : {}),
        sampleCount: payload.state.sampleCount,
        windowSize: payload.state.windowSize,
        startAt: payload.state.startAt,
        endAt: payload.state.endAt,
        ageMinutes: payload.state.ageMinutes,
        windowMinutes: payload.state.windowMinutes,
      };
      emitChunk({
        type: 'data-affect-signal',
        id: 'affect-signal',
        data,
      });
    },
    emitTokenUsage: payload => {
      if (terminated) return;
      ensureStarted();
      const data: TokenUsagePartData = {
        ...(typeof payload?.inputTokens === 'number' ? { inputTokens: payload.inputTokens } : {}),
        ...(typeof payload?.outputTokens === 'number'
          ? { outputTokens: payload.outputTokens }
          : {}),
        ...(typeof payload?.totalTokens === 'number' ? { totalTokens: payload.totalTokens } : {}),
        ...(typeof payload?.cacheReadTokens === 'number'
          ? { cacheReadTokens: payload.cacheReadTokens }
          : {}),
        ...(typeof payload?.cacheWriteTokens === 'number'
          ? { cacheWriteTokens: payload.cacheWriteTokens }
          : {}),
        ...(typeof payload?.reasoningTokens === 'number'
          ? { reasoningTokens: payload.reasoningTokens }
          : {}),
        ...(typeof payload?.estimatedCostUsd === 'number'
          ? { estimatedCostUsd: payload.estimatedCostUsd }
          : {}),
        ...(typeof payload?.maxInputTokens === 'number'
          ? { maxInputTokens: payload.maxInputTokens }
          : {}),
        ...(typeof payload?.maxOutputTokens === 'number'
          ? { maxOutputTokens: payload.maxOutputTokens }
          : {}),
        ...(typeof payload?.model === 'string' ? { model: payload.model } : {}),
        ...(typeof payload?.providerType === 'string'
          ? { providerType: payload.providerType }
          : {}),
        ...(typeof payload?.providerId === 'string' ? { providerId: payload.providerId } : {}),
      };
      emitChunk({
        type: 'data-token-usage',
        id: 'token-usage',
        data,
      });
    },
    finish: () => {
      if (terminated) return;
      ensureStarted();
      closeText();
      emitChunk({ type: 'finish' });
      terminated = true;
    },
    abort: () => {
      if (terminated) return;
      ensureStarted();
      closeText();
      emitChunk({ type: 'abort' });
      terminated = true;
    },
    error: errorText => {
      if (terminated) return;
      ensureStarted();
      closeText();
      emitChunk({ type: 'error', errorText });
    },
  };
};
