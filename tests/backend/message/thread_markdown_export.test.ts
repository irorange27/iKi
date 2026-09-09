import { describe, expect, it } from 'vitest';

import {
  buildThreadMarkdown,
  parseStoredMessageForExport,
} from '../../../packages/backend/src/message/thread_markdown_export';

describe('thread_markdown_export', () => {
  it('renders a header and only user/assistant text messages', () => {
    const markdown = buildThreadMarkdown({
      title: 'Refactor loop',
      model: 'deepseek/deepseek-v4-pro',
      exportedAt: '2026-09-05T00:00:00.000Z',
      messages: [
        { role: 'user', parts: [{ type: 'text', text: 'Please refactor the loop.' }] },
        {
          role: 'assistant',
          parts: [
            { type: 'text', text: 'Done — see summary.' },
            { type: 'dynamic-tool', toolName: 'edit', state: 'output-available', input: {} },
          ],
        },
        { role: 'system', parts: [{ type: 'text', text: 'system prompt leak' }] },
        { role: 'assistant', parts: [{ type: 'text', text: '   ' }] },
      ],
    });

    expect(markdown).toContain('# Refactor loop');
    expect(markdown).toContain('- Model: deepseek/deepseek-v4-pro');
    expect(markdown).toContain('## User');
    expect(markdown).toContain('Please refactor the loop.');
    expect(markdown).toContain('## Assistant');
    expect(markdown).toContain('Done — see summary.');
    // System messages and whitespace-only messages are dropped.
    expect(markdown).not.toContain('system prompt leak');
  });

  it('notes when there is nothing exportable', () => {
    const markdown = buildThreadMarkdown({
      title: 'Empty',
      exportedAt: '2026-09-05T00:00:00.000Z',
      messages: [],
    });

    expect(markdown).toContain('# Empty');
    expect(markdown).toContain('no exportable messages');
  });

  it('parses persisted message rows and rejects malformed ones', () => {
    const parsed = parseStoredMessageForExport(
      JSON.stringify({ role: 'user', parts: [{ type: 'text', text: 'hi' }] })
    );
    expect(parsed?.role).toBe('user');

    expect(parseStoredMessageForExport('not json')).toBeNull();
    expect(parseStoredMessageForExport(JSON.stringify({ parts: [] }))).toBeNull();
    expect(parseStoredMessageForExport('')).toBeNull();
  });
});
