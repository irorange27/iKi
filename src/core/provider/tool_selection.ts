import {
  normalizeWhitespace,
  selectCatalogWithAgent,
  tryParseJson,
  type SelectionMessage,
} from './catalog_selection';
import { buildAffectDecisionMessage, type AffectState } from '../emotion/affect_state';
import { getToolModel } from './tool_model';

export type ToolSelectionMessage = SelectionMessage;

export type ToolCatalogItem = {
  name: string;
  displayName?: string;
  description?: string;
  needsApproval?: boolean;
  source?: {
    kind?: 'builtin' | 'mcp';
    name?: string;
  };
};

const MAX_INPUT_CHARS = 4500;
const MAX_MESSAGES = 16;
const MAX_OUTPUT_TOKENS = 280;
const MAX_TOOLS_SELECTED = 6;
const MAX_CATALOG_ITEMS = 40;

const SYSTEM_PROMPT =
  'You are a tool router for an AI assistant.\n' +
  'Your job: pick the smallest set of tools the assistant is likely to need for the current turn.\n' +
  'Rules:\n' +
  '- Output ONLY valid JSON.\n' +
  '- Prefer using NO tools when possible.\n' +
  '- If the user asks about current local machine state or other live information the model cannot know reliably on its own (for example current time, filesystem contents, git status, installed tools, running processes, or live web data), include the tool needed to verify it instead of guessing.\n' +
  '- Include `todo` only when the task is genuinely substantial and multi-step: usually work expected to need at least 3 meaningful actions, several tool rounds, or explicit progress tracking.\n' +
  '- Do NOT include `todo` for simple questions, one-shot lookups, single command checks, single file reads, or straightforward single edits.\n' +
  '- Include `agent` only when a bounded subtask would benefit from a fresh delegated scratchpad. Do NOT include `agent` for trivial work, or when the main agent can directly use the needed tools itself.\n' +
  '- Do NOT rely on `agent` for approval-gated or destructive actions; keep those under the main agent.\n' +
  '- Prefer 1-3 tools; only exceed that when a multi-step workflow clearly needs it.\n' +
  '- If a task likely needs a longer sequential workflow in one turn (for example inspect -> edit -> verify), include each needed tool and add `todo` only when the workflow is not trivial.\n' +
  '- Prefer tools that do not require approval unless approval-gated tools are clearly necessary.\n' +
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
    const displayName =
      typeof tool.displayName === 'string' && tool.displayName.trim() && tool.displayName !== tool.name
        ? normalizeWhitespace(tool.displayName)
        : '';
    const sourceLabel =
      tool.source?.kind === 'mcp'
        ? `mcp${tool.source.name ? `:${normalizeWhitespace(tool.source.name)}` : ''}`
        : 'builtin';
    const approvalLabel = tool.needsApproval ? 'approval-required' : 'no-approval';
    const metadata = [sourceLabel, approvalLabel].join('; ');
    return `- ${tool.name}${displayName ? ` (${displayName})` : ''} [${metadata}]${desc ? `: ${desc}` : ''}`;
  });
  return lines.join('\n');
};

export const selectToolsWithAgent = async (params: {
  messages: ToolSelectionMessage[];
  availableTools: ToolCatalogItem[];
  affectState?: AffectState | null;
}): Promise<string[] | null> => {
  const toolModel = getToolModel();
  if (!toolModel) return null;
  const affectMessage = params.affectState ? buildAffectDecisionMessage(params.affectState) : '';

  return selectCatalogWithAgent({
    messages: params.messages,
    availableCatalog: params.availableTools,
    buildCatalogText: buildToolCatalogText,
    buildPrompt: (catalogText, transcript) =>
      'Tool catalog (choose only from these exact names):\n' +
      `${catalogText}\n\n` +
      (affectMessage ? `Current user affect signal:\n${affectMessage}\n\n` : '') +
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
