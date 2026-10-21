import { describe, expect, it } from 'vitest';

import {
  parseToolInputPayload,
  parseToolOutputPayload,
  resolveToolPayloadKind,
} from '@iki/backend/message/tool_payload_contracts';

/**
 * Schemas-free parsing kernel (P1 split). These are the decode rules the
 * renderer relies on; the schema-validated variants stay covered by
 * tests/shared/message/tool_payloads.test.ts.
 */

describe('resolveToolPayloadKind', () => {
  it('normalizes the tool name and applies aliases', () => {
    expect(resolveToolPayloadKind('web_search')).toBe('web');
    expect(resolveToolPayloadKind('Web Search')).toBe('web');
    expect(resolveToolPayloadKind('read-todo-list')).toBe('read_todo_list');
    expect(resolveToolPayloadKind('nope')).toBeNull();
  });
});

describe('parseToolInputPayload', () => {
  it('decodes a JSON input string and reports its kind', () => {
    expect(parseToolInputPayload('web_search', '{"query":"hello","limit":3}')).toEqual({
      kind: 'web',
      payload: { query: 'hello', limit: 3 },
    });
  });

  it('passes an object input through unchanged', () => {
    const input = { command: 'pwd' };
    expect(parseToolInputPayload('shell', input)).toEqual({ kind: 'shell', payload: input });
  });

  it('keeps unparseable and non-object values unknown with the original value', () => {
    expect(parseToolInputPayload('fetch', 'not json')).toEqual({
      kind: 'unknown',
      payload: 'not json',
    });
    expect(parseToolInputPayload('fetch', 42)).toEqual({ kind: 'unknown', payload: 42 });
    expect(parseToolInputPayload('nope', { ok: true })).toEqual({
      kind: 'unknown',
      payload: { ok: true },
    });
  });
});

describe('parseToolOutputPayload', () => {
  it('decodes JSON output strings for every registered kind', () => {
    expect(parseToolOutputPayload('edit', '{"path":"a.ts","changed":true}')).toEqual({
      kind: 'edit',
      payload: { path: 'a.ts', changed: true },
    });
    expect(parseToolOutputPayload('load_skill', '{"id":"user:planner","name":"Planner"}')).toEqual({
      kind: 'load_skill',
      payload: { id: 'user:planner', name: 'Planner' },
    });
  });

  it('delegates to an injected validator when one is supplied', () => {
    const rejectEverything: Parameters<typeof parseToolOutputPayload>[2] = () => null;
    expect(parseToolOutputPayload('edit', { path: 'a.ts' }, rejectEverything)).toEqual({
      kind: 'unknown',
      payload: { path: 'a.ts' },
    });

    const validated = { marked: true };
    expect(parseToolOutputPayload('edit', { path: 'a.ts' }, () => validated)).toEqual({
      kind: 'edit',
      payload: validated,
    });
  });
});
