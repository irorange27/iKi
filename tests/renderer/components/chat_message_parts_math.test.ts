// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import type { UIMessage } from 'ai';

import ChatMessageParts from '../../../packages/desktop/src/renderer/components/chat/ChatMessageParts.vue';

// Math support is verified through the real renderer component: markdown-it
// plugin wiring, KaTeX output, and the fallback path all live downstream of it.
const renderText = (text: string, role: 'assistant' | 'user' = 'assistant') =>
  mount(ChatMessageParts, {
    props: {
      message: {
        id: `${role}_math`,
        role,
        parts: [{ type: 'text', text }],
      } as unknown as UIMessage,
      messageIndex: 0,
      activeAssistantMessageId: null,
      approvalProcessing: () => false,
      getMcpServerLabel: () => '',
    },
  });

const bodyOf = (text: string, role: 'assistant' | 'user' = 'assistant') =>
  renderText(text, role).find('.message-text');

describe('ChatMessageParts math rendering', () => {
  it('typesets $…$ inline math', () => {
    const body = bodyOf('Energy is $E = mc^2$ exactly.');

    expect(body.find('.katex').exists()).toBe(true);
    expect(body.find('.md-math-block').exists()).toBe(false);
    // The delimiters are consumed, not printed.
    expect(body.text()).not.toContain('$');
    expect(body.text()).toContain('Energy is');
    expect(body.text()).toContain('exactly.');
  });

  it('typesets several $…$ spans in one paragraph', () => {
    const body = bodyOf('From $a$ to $b$.');

    expect(body.findAll('.katex')).toHaveLength(2);
    expect(body.text()).not.toContain('$');
  });

  it('typesets a $$…$$ block as display math', () => {
    const body = bodyOf('Before\n\n$$\n\\int_0^1 x^2 \\, dx\n$$\n\nAfter');

    expect(body.find('.md-math-block .katex-display').exists()).toBe(true);
    expect(body.text()).toContain('Before');
    expect(body.text()).toContain('After');
  });

  it('typesets a single-line $$…$$ block', () => {
    const body = bodyOf('$$x = 1$$');

    expect(body.find('.md-math-block .katex-display').exists()).toBe(true);
  });

  it('typesets inline $$…$$ without dropping the surrounding text', () => {
    const body = bodyOf('Before $$x^2$$ after.');

    expect(body.find('.md-math-display .katex-display').exists()).toBe(true);
    expect(body.text()).toContain('Before');
    expect(body.text()).toContain('after.');
  });

  it('typesets LaTeX-style \\( and \\[ delimiters', () => {
    const inline = bodyOf('The ratio \\(a/b\\) holds.');
    expect(inline.find('.katex').exists()).toBe(true);

    const display = bodyOf('\\[a^2 + b^2 = c^2\\]');
    expect(display.find('.md-math-block .katex-display').exists()).toBe(true);
  });

  it('renders math inside user messages too', () => {
    const body = bodyOf('Solve $x + 1 = 2$', 'user');

    expect(body.find('.katex').exists()).toBe(true);
  });

  it('leaves currency amounts as prose', () => {
    const body = bodyOf('It costs $5 and $6 in total.');

    expect(body.findAll('.katex')).toHaveLength(0);
    expect(body.text()).toContain('It costs $5 and $6 in total.');
  });

  it('keeps an escaped dollar literal', () => {
    const body = bodyOf('Ranges: \\$5 to \\$10.');

    expect(body.findAll('.katex')).toHaveLength(0);
    expect(body.text()).toContain('Ranges: $5 to $10.');
  });

  it('does not typeset math inside code spans or fences', () => {
    const body = bodyOf('```python\ncost = $5\n```\n\nUse `$x$` inline.');

    expect(body.findAll('.katex')).toHaveLength(0);
    expect(body.find('.md-code-block code').text()).toContain('cost = $5');
    expect(body.html()).toContain('$x$');
  });

  it('falls back to the raw source when the LaTeX is invalid', () => {
    const body = bodyOf('Broken $\\frac{1}{$ end.');

    expect(body.findAll('.katex')).toHaveLength(0);
    expect(body.find('.md-math-fallback').text()).toBe('$\\frac{1}{$');
    expect(body.text()).toContain('end.');
  });

  it('leaves an unclosed $$ block as text instead of swallowing the message', () => {
    const body = bodyOf('$$\nunclosed\n\nafter paragraph');

    expect(body.findAll('.katex')).toHaveLength(0);
    expect(body.find('.md-math-block').exists()).toBe(false);
    expect(body.text()).toContain('after paragraph');
  });

  it('falls back inside a display block too', () => {
    const body = bodyOf('Before\n\n$$\n\\frac{1}{\n$$\n\nAfter');

    expect(body.find('.md-math-block.is-fallback .md-math-fallback').text()).toBe('$$\\frac{1}{$$');
    expect(body.text()).toContain('After');
  });

  it('keeps untrusted LaTeX commands inert', () => {
    const body = bodyOf('$\\href{javascript:alert(1)}{x}$');

    // KaTeX runs with `trust: false`: the command is refused instead of
    // becoming a link, and no URL reaches the DOM.
    expect(body.find('.katex').exists()).toBe(true);
    expect(body.html()).not.toContain('<a ');
    expect(body.html()).not.toContain('href=');
  });
});
