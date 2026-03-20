import type { UIMessage, UIMessageChunk } from 'ai';
import { describe, expect, it } from 'vitest';

import {
  createInitialStreamState,
  reduceStream,
  type MessageOp,
  type StreamAction,
  type StreamState,
} from '../../src/renderer/modules/chat/ui_stream_reducer';

const applyMessageOps = (messages: UIMessage[], ops: MessageOp[]) => {
  for (const op of ops) {
    if (op.type === 'append') {
      messages.push(op.message);
      continue;
    }

    const index = messages.findIndex(message => message.id === op.messageId);
    if (op.type === 'replace') {
      if (index >= 0) {
        messages.splice(index, 1, op.message);
      } else {
        messages.push(op.message);
      }
      continue;
    }

    if (index >= 0) {
      messages.splice(index, 1);
    }
  }
};

const runReducer = (
  initialState: StreamState,
  actions: StreamAction[]
): { state: StreamState; messages: UIMessage[] } => {
  const messages: UIMessage[] = [];
  let state = initialState;
  let idSequence = 0;

  for (const action of actions) {
    const result = reduceStream(
      state,
      {
        messages,
        createMessageId: () => `assistant_${++idSequence}`,
        currentThreadId: 'thread_1',
        nowMs: 1000,
        toolUiStateMap: {},
      },
      action
    );
    applyMessageOps(messages, result.messageOps);
    state = result.state;
  }

  return { state, messages };
};

describe('ui_stream_reducer', () => {
  it('stores skill usage as a first-class assistant message part', () => {
    const { messages } = runReducer(createInitialStreamState(), [
      { type: 'begin_turn', threadId: 'thread_1', parentId: 'user_1' },
      {
        type: 'skill_chunk',
        chunk: {
          mode: 'auto',
          skills: [
            {
              id: 'codex:.system/openai-docs',
              name: 'openai-docs',
              description: 'Official docs',
              source: 'codex',
            },
          ],
        },
      },
      { type: 'text_delta', delta: 'Response text' },
      { type: 'finalize_response', fullText: 'Response text' },
    ]);

    expect(messages).toHaveLength(1);
    const [assistant] = messages;
    expect(assistant.parts[0]).toEqual({
      type: 'skill-usage',
      mode: 'auto',
      skills: [
        {
          id: 'codex:.system/openai-docs',
          name: 'openai-docs',
          description: 'Official docs',
          source: 'codex',
        },
      ],
    });
  });

  it('stores context reports as a first-class assistant message part', () => {
    const { messages } = runReducer(createInitialStreamState(), [
      { type: 'begin_turn', threadId: 'thread_1', parentId: 'user_1' },
      {
        type: 'context_chunk',
        chunk: {
          totalEstimatedTokens: 320,
          retainedRecentMessages: 5,
          compactedMessages: 9,
          blocks: [
            {
              kind: 'thread-summary',
              status: 'included',
              estimatedTokens: 120,
              charCount: 480,
              sourceCount: 9,
            },
          ],
        },
      },
      { type: 'text_delta', delta: 'Response text' },
      { type: 'finalize_response', fullText: 'Response text' },
    ]);

    expect(messages).toHaveLength(1);
    const [assistant] = messages;
    expect(assistant.parts[0]).toEqual({
      type: 'context-report',
      totalEstimatedTokens: 320,
      retainedRecentMessages: 5,
      compactedMessages: 9,
      blocks: [
        {
          kind: 'thread-summary',
          status: 'included',
          estimatedTokens: 120,
          charCount: 480,
          sourceCount: 9,
        },
      ],
    });
  });

  it('removes duplicate text when identical content appears before and after a tool result', () => {
    const duplicateText =
      'Stopping playback now. Music has fully stopped. Do you want me to continue?';
    const { messages } = runReducer(createInitialStreamState(), [
      { type: 'begin_turn', threadId: 'thread_1', parentId: 'user_1' },
      { type: 'text_delta', delta: duplicateText },
      {
        type: 'tool_chunk',
        chunk: {
          type: 'tool-input-available',
          toolCallId: 'tool_1',
          toolName: 'shell',
          input: { command: 'echo stop' },
        } as UIMessageChunk,
      },
      {
        type: 'tool_chunk',
        chunk: {
          type: 'tool-output-available',
          toolCallId: 'tool_1',
          toolName: 'shell',
          output: { stdout: 'stopped' },
          preliminary: false,
        } as UIMessageChunk,
      },
      { type: 'text_delta', delta: duplicateText },
      { type: 'finalize_response', fullText: `${duplicateText}${duplicateText}` },
    ]);

    expect(messages).toHaveLength(1);
    const [assistant] = messages;
    const textParts = assistant.parts.filter(
      part => part.type === 'text' && typeof part.text === 'string'
    ) as Array<{ type: 'text'; text: string }>;
    const toolParts = assistant.parts.filter(part => part.type !== 'text');

    expect(textParts).toHaveLength(1);
    expect(textParts[0].text).toBe(duplicateText);
    expect(toolParts.length).toBeGreaterThan(0);
  });

  it('keeps distinct text segments around tool chunks', () => {
    const beforeText = 'I will run this action first.';
    const afterText = 'Execution finished. You can continue with the next step.';
    const { messages } = runReducer(createInitialStreamState(), [
      { type: 'begin_turn', threadId: 'thread_1', parentId: 'user_1' },
      { type: 'text_delta', delta: beforeText },
      {
        type: 'tool_chunk',
        chunk: {
          type: 'tool-input-available',
          toolCallId: 'tool_2',
          toolName: 'shell',
          input: { command: 'echo run' },
        } as UIMessageChunk,
      },
      {
        type: 'tool_chunk',
        chunk: {
          type: 'tool-output-available',
          toolCallId: 'tool_2',
          toolName: 'shell',
          output: { stdout: 'ok' },
          preliminary: false,
        } as UIMessageChunk,
      },
      { type: 'text_delta', delta: afterText },
      { type: 'finalize_response', fullText: `${beforeText}${afterText}` },
    ]);

    expect(messages).toHaveLength(1);
    const [assistant] = messages;
    const textParts = assistant.parts.filter(
      part => part.type === 'text' && typeof part.text === 'string'
    ) as Array<{ type: 'text'; text: string }>;

    expect(textParts).toHaveLength(2);
    expect(textParts[0].text).toBe(beforeText);
    expect(textParts[1].text).toBe(afterText);
  });
});
