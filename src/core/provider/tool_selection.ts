import {
  normalizeWhitespace,
  selectCatalogWithAgent,
  tryParseJson,
  type SelectionMessage,
} from './catalog_selection';
import { getToolModel } from './tool_model';

export type ToolSelectionMessage = SelectionMessage;

export type ToolCatalogItem = {
  name: string;
  description?: string;
};

const MAX_INPUT_CHARS = 4500;
const MAX_MESSAGES = 16;
const MAX_OUTPUT_TOKENS = 240;
const MAX_TOOLS_SELECTED = 4;
const MAX_CATALOG_ITEMS = 40;

const SYSTEM_PROMPT =
  'You are a tool router for an AI assistant.\n' +
  'Your job: pick the minimal set of tools that would materially improve the next response.\n' +
  'Rules:\n' +
  '- Output ONLY valid JSON.\n' +
  '- Prefer using NO tools when possible.\n' +
  '- Return a JSON array of tool names. Example: ["web","fetch"].\n' +
  '- If no tool is needed, return [].\n' +
  '- Never invent tool names not present in the catalog.\n' +
  `- Choose at most ${MAX_TOOLS_SELECTED} tools.\n`;

const normalizeToolName = (value: string, canonicalByLower: Map<string, string>): string | null => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  return canonicalByLower.get(trimmed.toLowerCase()) ?? null;
};

const parseToolNames = (raw: string, availableTools: ToolCatalogItem[]): string[] => {
  const parsed = tryParseJson(raw);
  if (!parsed) return [];

  const canonicalByLower = new Map<string, string>();
  for (const tool of availableTools) {
    canonicalByLower.set(tool.name.toLowerCase(), tool.name);
  }

  const fromArray = (values: unknown[]): string[] => {
    const selected: string[] = [];
    const seen = new Set<string>();
    for (const value of values) {
      if (typeof value !== 'string') continue;
      const normalized = normalizeToolName(value, canonicalByLower);
      if (!normalized) continue;
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      selected.push(normalized);
      if (selected.length >= MAX_TOOLS_SELECTED) break;
    }
    return selected;
  };

  if (Array.isArray(parsed)) {
    return fromArray(parsed);
  }

  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const toolsValue = (parsed as { tools?: unknown; toolNames?: unknown }).tools;
    const toolNamesValue = (parsed as { tools?: unknown; toolNames?: unknown }).toolNames;

    if (Array.isArray(toolsValue)) {
      return fromArray(toolsValue);
    }
    if (Array.isArray(toolNamesValue)) {
      return fromArray(toolNamesValue);
    }
  }

  return [];
};

const buildToolCatalogText = (tools: ToolCatalogItem[]) => {
  if (!tools.length) return '';
  const sliced = tools.slice(0, MAX_CATALOG_ITEMS);
  const lines = sliced.map(tool => {
    const desc = normalizeWhitespace(tool.description || '');
    return `- ${tool.name}${desc ? `: ${desc}` : ''}`;
  });
  return lines.join('\n');
};

export const selectToolsWithAgent = async (params: {
  messages: ToolSelectionMessage[];
  availableTools: ToolCatalogItem[];
}): Promise<string[] | null> => {
  const toolModel = getToolModel();
  if (!toolModel) return null;

  return selectCatalogWithAgent({
    messages: params.messages,
    availableCatalog: params.availableTools,
    buildCatalogText: buildToolCatalogText,
    buildPrompt: (catalogText, transcript) =>
      'Tool catalog (choose only from these exact names):\n' +
      `${catalogText}\n\n` +
      'Conversation (most recent last):\n' +
      `${transcript}\n\n` +
      'Return ONLY a JSON array of tool names.\n',
    parseSelection: (raw, catalog) => parseToolNames(raw, catalog),
    systemPrompt: SYSTEM_PROMPT,
    maxMessages: MAX_MESSAGES,
    maxInputChars: MAX_INPUT_CHARS,
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    logLabel: 'ToolSelection',
  });
};
