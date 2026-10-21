import { describe, expect, it } from 'vitest';

import {
  getParsedToolInput,
  getParsedToolOutput,
} from '../../../../packages/desktop/src/renderer/modules/chat/tool_payloads';

const shellPart = (overrides: Record<string, unknown> = {}) => ({
  type: 'dynamic-tool',
  toolName: 'shell',
  toolCallId: 'call_1',
  state: 'output-available',
  input: { command: 'whoami' },
  output: { stdout: 'nina\n', exitCode: 0 },
  ...overrides,
});

describe('getParsedToolInput', () => {
  it('reports the resolved kind and the decoded object payload', () => {
    expect(getParsedToolInput(shellPart())).toEqual({
      kind: 'shell',
      input: { command: 'whoami' },
    });
  });

  it('JSON-decodes a streaming string input', () => {
    expect(
      getParsedToolInput({
        type: 'dynamic-tool',
        toolName: 'web_search',
        toolCallId: 'call_2',
        state: 'input-available',
        input: '{"query":"hello","limit":3}',
      })
    ).toEqual({ kind: 'web', input: { query: 'hello', limit: 3 } });
  });

  it('falls back to unknown with the raw value when the payload is not decodable', () => {
    expect(getParsedToolInput(shellPart({ input: 'not json' }))).toEqual({
      kind: 'unknown',
      input: 'not json',
    });
    expect(getParsedToolInput(shellPart({ toolName: 'nope', input: { a: 1 } }))).toEqual({
      kind: 'unknown',
      input: { a: 1 },
    });
  });

  it('handles a non-object part without throwing', () => {
    expect(getParsedToolInput('nope')).toEqual({ kind: 'unknown', input: undefined });
    expect(getParsedToolInput(undefined)).toEqual({ kind: 'unknown', input: undefined });
  });
});

describe('getParsedToolOutput', () => {
  it('reports the kind plus the output object for the cards to read', () => {
    expect(getParsedToolOutput(shellPart())).toEqual({
      kind: 'shell',
      output: { stdout: 'nina\n', exitCode: 0 },
    });
  });

  it('decodes JSON string outputs', () => {
    expect(getParsedToolOutput(shellPart({ output: '{"stdout":"ok\\n","exitCode":0}' }))).toEqual({
      kind: 'shell',
      output: { stdout: 'ok\n', exitCode: 0 },
    });
  });

  it('keeps the pre-split fallback for non-object outputs', () => {
    expect(getParsedToolOutput(shellPart({ output: 'boom' }))).toEqual({
      kind: 'unknown',
      output: 'boom',
    });
  });

  it('caches per part and re-decodes when the raw reference moves', () => {
    const part = shellPart();
    const first = getParsedToolOutput(part);
    expect(getParsedToolOutput(part)).toBe(first);

    part.output = { stdout: 'later\n', exitCode: 1 };
    expect(getParsedToolOutput(part)).not.toBe(first);
    expect(getParsedToolOutput(part)).toEqual({
      kind: 'shell',
      output: { stdout: 'later\n', exitCode: 1 },
    });
  });
});
