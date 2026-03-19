import { describe, expect, it } from 'vitest';

import { resolveMcpToolResult } from '../../../src/core/mcp/tool_results';
import type { McpToolCatalogItem } from '../../../src/shared/types/mcp';

const toolWithOutputSchema: McpToolCatalogItem = {
  name: 'lookup',
  inputSchema: { type: 'object', properties: {} },
  outputSchema: {
    type: 'object',
    properties: {
      answer: { type: 'string' },
    },
    required: ['answer'],
  },
};

describe('resolveMcpToolResult', () => {
  it('returns raw MCP results when no output schema is declared', () => {
    const rawResult = {
      content: [{ type: 'text', text: 'plain text' }],
      isError: false,
    };

    expect(
      resolveMcpToolResult(
        {
          name: 'raw_tool',
          inputSchema: { type: 'object', properties: {} },
        },
        rawResult
      )
    ).toEqual(rawResult);
  });

  it('prefers structuredContent for tools with output schemas', () => {
    expect(
      resolveMcpToolResult(toolWithOutputSchema, {
        content: [{ type: 'text', text: '{"answer":"fallback"}' }],
        structuredContent: { answer: 'structured' },
        isError: false,
      })
    ).toEqual({ answer: 'structured' });
  });

  it('parses JSON text output when structuredContent is missing', () => {
    expect(
      resolveMcpToolResult(toolWithOutputSchema, {
        content: [{ type: 'text', text: '{"answer":"parsed"}' }],
        isError: false,
      })
    ).toEqual({ answer: 'parsed' });
  });

  it('throws when typed output is returned as non-JSON text', () => {
    expect(() =>
      resolveMcpToolResult(toolWithOutputSchema, {
        content: [{ type: 'text', text: 'not json' }],
        isError: false,
      })
    ).toThrow(/non-json text output/i);
  });

  it('throws when a typed tool returns an MCP error result', () => {
    expect(() =>
      resolveMcpToolResult(toolWithOutputSchema, {
        content: [{ type: 'text', text: 'lookup failed' }],
        isError: true,
      })
    ).toThrow(/lookup failed/i);
  });
});
