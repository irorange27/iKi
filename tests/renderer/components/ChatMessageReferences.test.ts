// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import type { UIMessage } from 'ai';

import ChatMessageReferences from '../../../src/renderer/components/chat/ChatMessageReferences.vue';

const createMessage = (): UIMessage =>
  ({
    id: 'assistant_1',
    role: 'assistant',
    parts: [
      {
        type: 'skill-usage',
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
        type: 'memory-retrieval',
        query: 'project constraints',
        results: [{ id: 'mem_1', summary: 'Long-term maintainability matters.' }],
      },
      {
        type: 'affect-signal',
        source: 'realtime',
        label: 'anger',
        confidence: 0.82,
        guardActive: true,
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
    expect(wrapper.text()).toContain('1 tools');
    expect(wrapper.text()).toContain('1 memories');
    expect(wrapper.text()).toContain('affect');
    expect(summaryItems[3].attributes('data-tooltip')).toContain('Loaded skills: Planner');
    expect(summaryItems[3].attributes('data-tooltip')).toContain(
      'Selected not loaded: openai-docs'
    );
    expect(summaryItems[3].attributes('title')).toBeUndefined();

    await summaryItems[3].trigger('click');

    expect(wrapper.find('.reference-panel').exists()).toBe(false);
    expect(wrapper.emitted('open-skill')).toBeUndefined();
  });
});
