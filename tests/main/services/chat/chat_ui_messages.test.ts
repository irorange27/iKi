import { describe, expect, it } from 'vitest';

import { toModelInputMessages } from '@iki/backend/thread_session/ui_messages';

describe('chat_ui message conversion', () => {
  it('strips canonical metadata parts before AI SDK model conversion', async () => {
    const converted = await toModelInputMessages([
      {
        id: 'assistant_1',
        role: 'assistant',
        parts: [
          {
            type: 'data-skill-usage',
            data: {
              mode: 'auto',
              skills: [{ id: 'user:planner', name: 'Planner' }],
            },
          },
          {
            type: 'data-memory-retrieval',
            data: {
              query: 'constraints',
              results: [{ id: 'mem_1', summary: 'Prefer durable abstractions.' }],
            },
          },
          {
            type: 'data-composer-invocation',
            data: {
              tokens: [{ id: 'prompt_music', kind: 'prompt-app', prefix: '', label: 'music' }],
            },
          },
          { type: 'text', text: 'Final answer.' },
        ],
      },
    ]);

    expect(converted).toHaveLength(1);
    expect(converted[0]?.role).toBe('assistant');
    expect(converted[0]?.content).toEqual([{ type: 'text', text: 'Final answer.' }]);
  });

  // A persisted mid-turn snapshot (crash/quit during tool execution or while a
  // tool approval was pending) contains tool parts in non-terminal states.
  describe('interrupted tool calls from persisted snapshots', () => {
    const expectPairedToolCalls = (
      converted: Awaited<ReturnType<typeof toModelInputMessages>>
    ) => {
      const openToolCallIds = new Set<string>();
      for (const message of converted) {
        if (message.role === 'assistant') {
          for (const part of message.content) {
            if (part.type === 'tool-call' && !part.providerExecuted) {
              openToolCallIds.add(part.toolCallId);
            }
          }
        } else if (message.role === 'tool') {
          for (const part of message.content) {
            if (part.type === 'tool-result') {
              expect(openToolCallIds.delete(part.toolCallId)).toBe(true);
            }
          }
        }
      }
      expect([...openToolCallIds]).toEqual([]);
    };

    it('pairs an approval-requested tool call with a recorded interruption instead of an unpaired tool-call', async () => {
      const converted = await toModelInputMessages([
        {
          id: 'user_1',
          role: 'user',
          parts: [{ type: 'text', text: 'Edit the config.' }],
        },
        {
          id: 'assistant_1',
          role: 'assistant',
          parts: [
            { type: 'text', text: 'I will edit the config file.' },
            {
              type: 'dynamic-tool',
              toolCallId: 'toolu_approval',
              toolName: 'write_file',
              state: 'approval-requested',
              input: { path: 'config.json', content: '{}' },
              approval: { id: 'approval_1' },
            },
          ],
        },
        {
          id: 'user_2',
          role: 'user',
          parts: [{ type: 'text', text: 'Never mind; just list the files.' }],
        },
      ]);

      expectPairedToolCalls(converted);
      const toolResults = converted.flatMap(message =>
        message.role === 'tool' ? message.content : []
      );
      const interruptedResult = toolResults.find(
        part => part.type === 'tool-result' && part.toolCallId === 'toolu_approval'
      );
      expect(interruptedResult).toBeDefined();
    });

    it('keeps an issued-but-unrecorded tool call visible instead of silently dropping it', async () => {
      const converted = await toModelInputMessages([
        {
          id: 'user_1',
          role: 'user',
          parts: [{ type: 'text', text: 'Run the build.' }],
        },
        {
          id: 'assistant_1',
          role: 'assistant',
          parts: [
            {
              type: 'dynamic-tool',
              toolCallId: 'toolu_inflight',
              toolName: 'run_shell',
              state: 'input-available',
              input: { command: 'pnpm build' },
            },
          ],
        },
        {
          id: 'user_2',
          role: 'user',
          parts: [{ type: 'text', text: 'The app restarted; what happened?' }],
        },
      ]);

      expectPairedToolCalls(converted);
      const toolCalls = converted.flatMap(message =>
        message.role === 'assistant' ? message.content : []
      );
      expect(
        toolCalls.some(part => part.type === 'tool-call' && part.toolCallId === 'toolu_inflight')
      ).toBe(true);
    });

    it('pairs an approval-responded tool call whose execution was never recorded', async () => {
      const converted = await toModelInputMessages([
        {
          id: 'user_1',
          role: 'user',
          parts: [{ type: 'text', text: 'Delete the branch.' }],
        },
        {
          id: 'assistant_1',
          role: 'assistant',
          parts: [
            {
              type: 'dynamic-tool',
              toolCallId: 'toolu_answered',
              toolName: 'run_shell',
              state: 'approval-responded',
              input: { command: 'git branch -D feature' },
              approval: { id: 'approval_2', approved: true },
            },
          ],
        },
        {
          id: 'user_2',
          role: 'user',
          parts: [{ type: 'text', text: 'Did it finish?' }],
        },
      ]);

      expectPairedToolCalls(converted);
    });

    it('leaves terminal tool parts untouched', async () => {
      const converted = await toModelInputMessages([
        {
          id: 'user_1',
          role: 'user',
          parts: [{ type: 'text', text: 'Read the file.' }],
        },
        {
          id: 'assistant_1',
          role: 'assistant',
          parts: [
            {
              type: 'dynamic-tool',
              toolCallId: 'toolu_done',
              toolName: 'read_file',
              state: 'output-available',
              input: { path: 'a.txt' },
              output: 'contents',
            },
          ],
        },
      ]);

      expectPairedToolCalls(converted);
      const toolResults = converted.flatMap(message =>
        message.role === 'tool' ? message.content : []
      );
      expect(
        toolResults.some(
          part =>
            part.type === 'tool-result' &&
            part.toolCallId === 'toolu_done' &&
            JSON.stringify(part.output).includes('contents')
        )
      ).toBe(true);
    });
  });
});
