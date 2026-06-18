// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import type { UIMessage } from 'ai';

import ChatMessageReferences from '../../../packages/desktop/src/renderer/components/chat/ChatMessageReferences.vue';

const createMessage = (): UIMessage =>
  ({
    id: 'assistant_1',
    role: 'assistant',
    parts: [
      {
        type: 'data-skill-usage',
        data: {
          mode: 'auto',
          skills: [
            {
              id: 'codex:.system/openai-docs',
              name: 'openai-docs',
              description: 'Official OpenAI docs guidance',
              source: 'codex',
            },
            {
              id: 'user:planner',
              name: 'Planner',
              description: 'Planning workflow',
              source: 'user',
            },
          ],
        },
      },
      {
        type: 'dynamic-tool',
        toolCallId: 'call_skill_1',
        toolName: 'load_skill',
        state: 'output-available',
        input: { id: 'user:planner' },
        output: {
          id: 'user:planner',
          name: 'Planner',
          source: 'user',
          content: '<skill id="user:planner">...</skill>',
          truncated: false,
        },
      },
      {
        type: 'data-memory-retrieval',
        data: {
          query: 'project constraints',
          results: [{ id: 'mem_1', summary: 'Long-term maintainability matters.' }],
        },
      },
      {
        type: 'data-affect-signal',
        data: {
          source: 'realtime',
          label: 'anger',
          confidence: 0.82,
          guardActive: true,
        },
      },
      {
        type: 'data-token-usage',
        data: {
          inputTokens: 640,
          outputTokens: 82,
          totalTokens: 722,
          maxInputTokens: 4600,
          model: 'gpt-5-mini',
          providerType: 'openai',
        },
      },
      {
        type: 'tool-result',
        toolCallId: 'call_1',
        toolName: 'web',
        state: 'output-available',
        input: { query: 'openai docs' },
        output: { results: [] },
      },
    ],
  }) as unknown as UIMessage;

describe('ChatMessageReferences', () => {
  it('renders static reference labels without expandable controls or detail panels', async () => {
    const wrapper = mount(ChatMessageReferences, {
      props: {
        message: createMessage(),
      },
    });

    const summaryItems = wrapper.findAll('.reference-summary-item');

    expect(summaryItems).toHaveLength(4);
    expect(wrapper.findAll('button.reference-summary-item')).toHaveLength(0);
    expect(wrapper.find('.reference-panel').exists()).toBe(false);
    expect(wrapper.text()).toContain('1 skills');
    expect(wrapper.text()).toContain('1 tool');
    expect(wrapper.text()).toContain('1 memories');
    expect(wrapper.text()).toContain('affect');
    expect(summaryItems[2].attributes('title')).toContain('Tools: web');
    expect(summaryItems[3].attributes('title')).toContain('Loaded skills: Planner');
    expect(summaryItems[3].attributes('title')).toContain(
      'Selected not loaded: openai-docs'
    );

    await summaryItems[3].trigger('click');

    expect(wrapper.find('.reference-panel').exists()).toBe(false);
    expect(wrapper.emitted('open-skill')).toBeUndefined();
  });

  it('hides the tool summary when only transcript-hidden todo planner calls exist', () => {
    const wrapper = mount(ChatMessageReferences, {
      props: {
        message: {
          id: 'assistant_2',
          role: 'assistant',
          parts: [
            {
              type: 'tool-result',
              toolCallId: 'call_todo_1',
              toolName: 'todo',
              state: 'output-available',
              output: { items: [{ id: '1', text: 'Inspect current code', status: 'completed' }] },
            },
            {
              type: 'tool-result',
              toolCallId: 'call_todo_2',
              toolName: 'todo',
              state: 'output-available',
              output: { items: [{ id: '2', text: 'Implement fix', status: 'in_progress' }] },
            },
          ],
        } as unknown as UIMessage,
      },
    });

    expect(wrapper.text()).not.toContain('tools');
    expect(wrapper.findAll('.reference-summary-item')).toHaveLength(0);
  });

  it('does not render a reference summary when token usage is the only assistant metadata', () => {
    const wrapper = mount(ChatMessageReferences, {
      props: {
        message: {
          id: 'assistant_usage_only',
          role: 'assistant',
          parts: [
            {
              type: 'data-token-usage',
              data: {
                inputTokens: 1200,
                totalTokens: 1330,
                maxInputTokens: 128000,
              },
            },
          ],
        } as unknown as UIMessage,
      },
    });

    expect(wrapper.find('.chat-message-references').exists()).toBe(false);
    expect(wrapper.findAll('.reference-summary-item')).toHaveLength(0);
  });
});
