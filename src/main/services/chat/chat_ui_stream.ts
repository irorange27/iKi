import type { UIMessageChunk } from 'ai';

import { defaultToolRegistry } from '../../../core/tools';
import type { AffectSignalPart, ContextReportItem } from '../../../shared/chat/message_parts';
import type { AffectSignal } from '../../../shared/emotion/affect';
import { isObjectRecord } from '../../../shared/chat/tool_parts';

import type { ChatWebContents, ToolStreamEvent, UiChunkEmitter } from './chat_types';
import { createRuntimeId } from './chat_ui_tool_parts';

const getNestedToolEventField = (
  event: ToolStreamEvent,
  field: 'toolCallId' | 'toolName'
): unknown => {
  if (field in event) return event[field];
  const nestedToolCall = event.toolCall;
  if (!isObjectRecord(nestedToolCall)) return undefined;
  return nestedToolCall[field];
};

const getToolCallIdFromEvent = (event: ToolStreamEvent): string => {
  const candidate =
    typeof getNestedToolEventField(event, 'toolCallId') === 'string'
      ? (getNestedToolEventField(event, 'toolCallId') as string)
      : typeof event.id === 'string'
        ? event.id
        : '';

  if (candidate.length > 0) return candidate;
  return createRuntimeId('tool_call');
};

const getToolNameFromEvent = (event: ToolStreamEvent): string =>
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

const toUiChunkFromToolEvent = (event: ToolStreamEvent): UIMessageChunk | null => {
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
    const chunk = {
      type: 'tool-output-available',
      toolCallId,
      toolName,
      output: event.output,
      dynamic: true,
      ...(title ? { title } : {}),
      ...(typeof event.preliminary === 'boolean' ? { preliminary: event.preliminary } : {}),
    };
    return chunk as unknown as UIMessageChunk;
  }
  if (event.type === 'tool-error') {
    const chunk = {
      type: 'tool-output-error',
      toolCallId,
      toolName,
      errorText:
        typeof event.error === 'string'
          ? event.error
          : event.error instanceof Error
            ? event.error.message
            : 'Tool execution failed',
      ...(title ? { title } : {}),
      dynamic: true,
    };
    return chunk as unknown as UIMessageChunk;
  }
  if (event.type === 'tool-output-denied') {
    return {
      type: 'tool-output-denied',
      toolCallId,
    };
  }
  if (event.type === 'tool-approval-request') {
    return {
      type: 'tool-approval-request',
      approvalId:
        typeof event.approvalId === 'string' && event.approvalId.length > 0
          ? event.approvalId
          : createRuntimeId('approval'),
      toolCallId,
    };
  }

  return null;
};

export const createUiChunkEmitter = (
  webContents: ChatWebContents,
  messageId: string = createRuntimeId('assistant')
): UiChunkEmitter => {
  let started = false;
  let textStarted = false;
  let terminated = false;

  const emitChunk = (
    chunk:
      | UIMessageChunk
      | { type: 'memory-retrieval'; query?: string; results?: Array<Record<string, unknown>> }
      | AffectSignalPart
      | {
          type: 'context-report';
          totalEstimatedTokens?: number;
          retainedRecentMessages?: number;
          compactedMessages?: number;
          blocks?: ContextReportItem[];
        }
  ) => {
    webContents.send('chat:ui-chunk', chunk);
  };

  const ensureStarted = () => {
    if (started || terminated) return;
    emitChunk({ type: 'start', messageId });
    started = true;
  };

  const ensureTextStarted = () => {
    ensureStarted();
    if (textStarted || terminated) return;
    emitChunk({ type: 'text-start', id: messageId });
    textStarted = true;
  };

  const closeText = () => {
    if (!textStarted || terminated) return;
    emitChunk({ type: 'text-end', id: messageId });
    textStarted = false;
  };

  return {
    messageId,
    emitTextDelta: delta => {
      if (!delta || terminated) return;
      ensureTextStarted();
      emitChunk({ type: 'text-delta', id: messageId, delta });
    },
    emitToolEvent: event => {
      if (terminated) return;
      ensureStarted();
      const uiChunk = toUiChunkFromToolEvent(event);
      if (uiChunk) emitChunk(uiChunk);
    },
    emitMemoryRetrieval: payload => {
      if (terminated) return;
      ensureStarted();
      emitChunk({
        type: 'memory-retrieval',
        query: payload?.query ?? '',
        results: Array.isArray(payload?.results) ? payload.results : [],
      });
    },
    emitAffectSignal: (payload: AffectSignal) => {
      if (terminated) return;
      ensureStarted();
      emitChunk({
        type: 'affect-signal',
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
      });
    },
    emitContextReport: payload => {
      if (terminated) return;
      ensureStarted();
      emitChunk({
        type: 'context-report',
        totalEstimatedTokens:
          typeof payload?.totalEstimatedTokens === 'number' ? payload.totalEstimatedTokens : 0,
        retainedRecentMessages:
          typeof payload?.retainedRecentMessages === 'number' ? payload.retainedRecentMessages : 0,
        compactedMessages:
          typeof payload?.compactedMessages === 'number' ? payload.compactedMessages : 0,
        blocks: Array.isArray(payload?.blocks) ? payload.blocks : [],
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
