import { describe, expect, it } from 'vitest';

import { parseToolInput, parseToolOutput } from '../../../src/shared/chat/tool_payloads';

describe('parseToolInput', () => {
  it('parses JSON input and handles aliases', () => {
    const parsed = parseToolInput('web_search', '{"query":"hello","limit":3}');

    expect(parsed.kind).toBe('web');
    if (parsed.kind !== 'web') throw new Error('Expected web tool payload');
    expect(parsed.input.query).toBe('hello');
    expect(parsed.input.limit).toBe(3);
  });

  it('returns unknown for non-object input', () => {
    const parsed = parseToolInput('fetch', 'not json');
    expect(parsed).toEqual({ kind: 'unknown', input: 'not json' });
  });

  it('parses todo tool payloads from JSON', () => {
    const parsed = parseToolInput(
      'write_todo_list',
      '{"title":"Today","items":[{"content":"Ship feature","completed":false}]}'
    );

    expect(parsed.kind).toBe('write_todo_list');
    if (parsed.kind !== 'write_todo_list') throw new Error('Expected todo tool payload');
    expect(parsed.input.title).toBe('Today');
    expect(parsed.input.items?.[0]?.content).toBe('Ship feature');
  });
});

describe('parseToolOutput', () => {
  it('parses list_dir outputs from JSON', () => {
    const parsed = parseToolOutput('list_dir', '[{"name":"src","isDirectory":true}]');

    expect(parsed.kind).toBe('list_dir');
    if (parsed.kind !== 'list_dir') throw new Error('Expected list_dir tool payload');
    expect(parsed.output[0]?.name).toBe('src');
  });

  it('returns unknown for unsupported tools', () => {
    const parsed = parseToolOutput('nope', { ok: true });
    expect(parsed).toEqual({ kind: 'unknown', output: { ok: true } });
  });

  it('parses todo tool outputs from JSON', () => {
    const parsed = parseToolOutput(
      'read_todo_list',
      '{"list":{"id":"todo_1","title":"Today","items":[{"content":"Ship feature","status":"pending"}]}}'
    );

    expect(parsed.kind).toBe('read_todo_list');
    if (parsed.kind !== 'read_todo_list') throw new Error('Expected read_todo_list payload');
    expect(parsed.output.list?.title).toBe('Today');
    expect(parsed.output.list?.items?.[0]?.status).toBe('pending');
  });
});
