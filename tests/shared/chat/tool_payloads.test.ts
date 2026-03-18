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
});
