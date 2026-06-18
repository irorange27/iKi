import {
  getToolCallIdFromPart,
  getToolInput,
  getToolName,
  parseToolInputFromText,
} from './ui_message_tool_parts';
import type { ToolUiState, ToolUiStatePatch } from './tool_ui_state';
import {
  isDynamicToolPart,
  isObjectRecord,
  isTextPart,
  type DynamicToolPart,
  type UiMessagePart,
} from '@iki/core/chat/message_parts';
import { normalizeToolPartForValidation } from '@iki/core/chat/tool_parts';
import { updateAssistantMessage } from './ui_stream_reducer_message';
import type {
  ReduceResult,
  StatefulToolUiChunk,
  StreamContext,
  StreamEffect,
  StreamState,
  ToolUiChunk,
} from './ui_stream_reducer_types';

const finalizeStreamingTextParts = (parts: UiMessagePart[]): UiMessagePart[] =>
  parts.map(part =>
    isTextPart(part) && part.state === 'streaming'
      ? {
          ...part,
          state: 'done',
        }
      : part
  );

const buildToolPartUpdate = (
  part: DynamicToolPart,
  chunk: StatefulToolUiChunk,
  inputText?: string
): DynamicToolPart => {
  const mergeInput = (currentInput: unknown, incomingInput: unknown): unknown => {
    if (isObjectRecord(currentInput) && isObjectRecord(incomingInput)) {
      return { ...currentInput, ...incomingInput };
    }
    return incomingInput ?? currentInput ?? {};
  };

  const nextPartRecord: Record<string, unknown> = {
    ...part,
    type: 'dynamic-tool',
    toolCallId: part.toolCallId,
    toolName: part.toolName,
  };

  if ('providerExecuted' in chunk && typeof chunk.providerExecuted === 'boolean') {
    nextPartRecord.providerExecuted = chunk.providerExecuted;
  }
  if ('title' in chunk && typeof chunk.title === 'string') {
    nextPartRecord.title = chunk.title;
  }
  if ('providerMetadata' in chunk && isObjectRecord(chunk.providerMetadata)) {
    nextPartRecord.callProviderMetadata = chunk.providerMetadata;
  }

  if (chunk.type === 'tool-input-start') {
    nextPartRecord.state = 'input-streaming';
    nextPartRecord.input = part.input ?? {};
  } else if (chunk.type === 'tool-input-delta') {
    nextPartRecord.state = 'input-streaming';
    nextPartRecord.input = parseToolInputFromText(
      typeof inputText === 'string' ? inputText : ''
    );
  } else if (chunk.type === 'tool-input-available') {
    nextPartRecord.state = 'input-available';
    nextPartRecord.input = mergeInput(part.input, chunk.input);
  } else if (chunk.type === 'tool-input-error') {
    nextPartRecord.state = 'output-error';
    nextPartRecord.input = mergeInput(part.input, chunk.input);
    nextPartRecord.errorText = chunk.errorText || 'Invalid tool input';
  } else if (chunk.type === 'tool-output-available') {
    nextPartRecord.state = 'output-available';
    nextPartRecord.input = part.input ?? {};
    nextPartRecord.output = chunk.output;
    if (typeof chunk.preliminary === 'boolean') {
      nextPartRecord.preliminary = chunk.preliminary;
    }
  } else if (chunk.type === 'tool-output-error') {
    nextPartRecord.state = 'output-error';
    nextPartRecord.input = part.input ?? {};
    nextPartRecord.errorText = chunk.errorText || 'Tool execution failed';
  } else if (chunk.type === 'tool-output-denied') {
    nextPartRecord.state = 'output-denied';
    nextPartRecord.input = part.input ?? {};
  }

  return normalizeToolPartForValidation(nextPartRecord, part.toolCallId) ?? part;
};

const buildToolUiStatePatch = (
  chunk: StatefulToolUiChunk,
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
    ensureStartedAt();
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

const reduceApprovalRequestChunk = (
  state: StreamState,
  ctx: StreamContext,
  chunk: Extract<ToolUiChunk, { type: 'tool-approval-request' }>
): ReduceResult => {
  const existingMessage = state.activeAssistantMessageId
    ? ctx.messages.find(message => message.id === state.activeAssistantMessageId)
    : undefined;
  const existingPart = existingMessage?.parts.find(
    part => getToolCallIdFromPart(part) === chunk.toolCallId
  );
  const chunkRecord = chunk as Record<string, unknown>;
  const existingToolName =
    getToolName(existingPart) ||
    (typeof chunkRecord.toolName === 'string' ? (chunkRecord.toolName as string) : undefined);
  const existingInput =
    getToolInput(existingPart) ??
    (isObjectRecord(chunkRecord.input) ? chunkRecord.input : {});

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
};

export const reduceToolChunkAction = (
  state: StreamState,
  ctx: StreamContext,
  chunk: ToolUiChunk
): ReduceResult => {
  if (chunk.type === 'tool-approval-request') {
    return reduceApprovalRequestChunk(state, ctx, chunk);
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
    const nextParts = finalizeStreamingTextParts(message.parts);
    const existingPartIndex = nextParts.findIndex(part => getToolCallIdFromPart(part) === toolCallId);
    const existingPart = existingPartIndex >= 0 ? nextParts[existingPartIndex] : undefined;
    const existingToolPart = isDynamicToolPart(existingPart) ? existingPart : undefined;
    const chunkToolName =
      'toolName' in chunk && typeof chunk.toolName === 'string' && chunk.toolName.trim()
        ? chunk.toolName
        : undefined;
    const basePart =
      normalizeToolPartForValidation(
        {
          ...(existingToolPart || {}),
          type: 'dynamic-tool',
          toolCallId,
          toolName: chunkToolName || (existingToolPart ? existingToolPart.toolName : 'tool'),
          input: existingToolPart?.input ?? {},
        },
        toolCallId
      ) ?? {
        type: 'dynamic-tool',
        toolCallId,
        toolName: chunkToolName || (existingToolPart ? existingToolPart.toolName : 'tool'),
        state: 'input-available',
        input: existingToolPart?.input ?? {},
      };

    const updatedPart = buildToolPartUpdate(basePart, chunk, nextInputText);

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
};
