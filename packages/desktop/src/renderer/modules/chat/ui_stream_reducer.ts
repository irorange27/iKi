import type { ChatUiMessage } from '@iki/backend/chat/message_parts';
import { reduceToolChunkAction } from './ui_stream_reducer_tools';
import { resetTransientState, updateAssistantMessage } from './ui_stream_reducer_message';
import {
  buildStreamingTextParts,
  dedupeToolBridgedRepeatedTextParts,
  finalizeTextParts,
  hasRenderableContent,
} from './ui_stream_reducer_text';
import {
  reduceAffectChunkAction,
  reduceMemoryChunkAction,
  reduceSkillChunkAction,
  reduceUsageChunkAction,
} from './ui_stream_reducer_metadata';
import type {
  ReduceResult,
  StreamAction,
  StreamContext,
  StreamEffect,
  StreamState,
} from './ui_stream_reducer_types';
export type {
  MessageOp,
  StreamEffect,
  StreamAction,
  StreamContext,
  StreamState,
} from './ui_stream_reducer_types';
export { createInitialStreamState } from './ui_stream_reducer_types';

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
    return reduceToolChunkAction(state, ctx, action.chunk);
  }

  if (action.type === 'memory_chunk') {
    return reduceMemoryChunkAction(state, ctx, action);
  }

  if (action.type === 'skill_chunk') {
    return reduceSkillChunkAction(state, ctx, action);
  }

  if (action.type === 'affect_chunk') {
    return reduceAffectChunkAction(state, ctx, action);
  }

  if (action.type === 'usage_chunk') {
    return reduceUsageChunkAction(state, ctx, action);
  }

  return { state, messageOps: [], effects: [] };
};
