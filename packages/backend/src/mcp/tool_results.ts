import type { CallToolResult, ContentBlock } from '@modelcontextprotocol/sdk/types.js';

import type { McpToolCatalogItem } from '@iki/backend/types/mcp';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const getJoinedTextContent = (content: ContentBlock[]): string | null => {
  const textParts = content
    .map(block => (block.type === 'text' && typeof block.text === 'string' ? block.text : null))
    .filter((value): value is string => value !== null)
    .map(value => value.trim())
    .filter(Boolean);

  if (textParts.length === 0) return null;
  return textParts.join('\n').trim() || null;
};

export const extractMcpToolErrorMessage = (result: CallToolResult): string | null => {
  if (isRecord(result.structuredContent)) {
    const message =
      typeof result.structuredContent.error === 'string'
        ? result.structuredContent.error
        : typeof result.structuredContent.message === 'string'
          ? result.structuredContent.message
          : null;
    if (message && message.trim()) {
      return message.trim();
    }
  }

  return getJoinedTextContent(result.content) ?? null;
};

export const resolveMcpToolResult = (
  tool: McpToolCatalogItem | undefined,
  result: CallToolResult
): unknown => {
  if (!tool?.outputSchema) {
    return result;
  }

  if (result.isError) {
    throw new Error(
      extractMcpToolErrorMessage(result) || `MCP tool "${tool.name}" returned an error result`
    );
  }

  if (isRecord(result.structuredContent)) {
    return result.structuredContent;
  }

  const textContent = getJoinedTextContent(result.content);
  if (textContent) {
    try {
      return JSON.parse(textContent);
    } catch {
      throw new Error(
        `MCP tool "${tool.name}" declared an output schema but returned non-JSON text output`
      );
    }
  }

  throw new Error(
    `MCP tool "${tool.name}" declared an output schema but returned no structured output`
  );
};
