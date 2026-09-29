// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import type { UIMessage } from 'ai';

import ChatMessageParts from '../../../packages/desktop/src/renderer/components/chat/ChatMessageParts.vue';

// The code-block plugin now takes its markdown-it types from the shared contract
// instead of declaring its own. These cases pin the rendered output so the type
// move cannot quietly change behaviour.
const renderText = (text: string) =>
  mount(ChatMessageParts, {
    props: {
      message: {
        id: 'assistant_code_block',
        role: 'assistant',
        parts: [{ type: 'text', text }],
      } as unknown as UIMessage,
      messageIndex: 0,
      activeAssistantMessageId: null,
      approvalProcessing: () => false,
      getMcpServerLabel: () => '',
    },
  }).find('.message-text');

describe('ChatMessageParts code blocks', () => {
  it('renders a fenced block with its language label and copy action', () => {
    const body = renderText('```ts\nconst x = 1;\n```');

    expect(body.find('.md-code-block').exists()).toBe(true);
    expect(body.find('.md-code-lang').text()).toBe('ts');
    expect(body.find('.md-code-copy-btn').exists()).toBe(true);
    expect(body.find('code.hljs.language-ts').exists()).toBe(true);
  });

  it('still renders a fence with no language hint', () => {
    const body = renderText('```\nplain text\n```');

    expect(body.find('.md-code-block').exists()).toBe(true);
    expect(body.find('.md-code-block code').text()).toContain('plain text');
  });

  it('escapes markup in fenced content', () => {
    const body = renderText('```\n<script>alert(1)</script>\n```');

    expect(body.find('.md-code-block').html()).not.toContain('<script>');
  });
});
