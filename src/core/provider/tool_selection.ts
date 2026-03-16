import { SimpleAgent } from '../agent';
import { getToolModel } from './tool_model';

export type ToolSelectionMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

export type ToolCatalogItem = {
  name: string;
  description: string;
};

const MAX_INPUT_CHARS = 4500;
const MAX_MESSAGES = 16;
const MAX_OUTPUT_TOKENS = 220;

const SYSTEM_PROMPT =
  'You are a tool router for an AI assistant.\n' +
  'Your job: pick the minimal set of tools that may be needed to correctly complete the user request.\n' +
  'Rules:\n' +
  '- Output ONLY valid JSON.\n' +
  '- Prefer using NO tools when possible.\n' +
  '- Return a JSON array of tool names. Example: ["web","fetch"].\n' +
  '- If no tool is needed, return [].\n' +
  '- Never invent tool names not present in the catalog.\n' +
  '- Only include high-risk tools (shell, write_file, delete_file) when explicitly needed by the request.\n';

const normalizeWhitespace = (value: string) => value.replace(/\s+/g, ' ').trim();

const formatRole = (role: ToolSelectionMessage['role']) =>
  role === 'assistant' ? 'Assistant' : role === 'system' ? 'System' : 'User';

const buildTranscript = (messages: ToolSelectionMessage[]) => {
  const recent = messages.slice(-MAX_MESSAGES);
  const lines: string[] = [];
  let totalChars = 0;

  for (let i = recent.length - 1; i >= 0; i -= 1) {
    const msg = recent[i];
    const content = normalizeWhitespace(msg.content || '');
    if (!content) continue;

    const line = `${formatRole(msg.role)}: ${content}`;
    const nextLen = line.length + (lines.length > 0 ? 1 : 0);
    if (totalChars + nextLen > MAX_INPUT_CHARS) break;
    lines.push(line);
    totalChars += nextLen;
  }

  return lines.reverse().join('\n');
};

const extractJsonCandidate = (raw: string): string => {
  const trimmed = raw.trim();
  if (!trimmed) return '';

  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  return (fencedMatch && fencedMatch[1] ? fencedMatch[1].trim() : trimmed).trim();
};

const tryParseJson = (raw: string): unknown => {
  const candidate = extractJsonCandidate(raw);
  if (!candidate) return null;

  // 1) Try direct JSON parse (best case)
  try {
    return JSON.parse(candidate);
  } catch {
    // continue
  }

  // 2) Try extracting a JSON array substring
  const arrayStart = candidate.indexOf('[');
  const arrayEnd = candidate.lastIndexOf(']');
  if (arrayStart !== -1 && arrayEnd !== -1 && arrayEnd > arrayStart) {
    const slice = candidate.slice(arrayStart, arrayEnd + 1);
    try {
      return JSON.parse(slice);
    } catch {
      // continue
    }
  }

  // 3) Try extracting a JSON object substring
  const objStart = candidate.indexOf('{');
  const objEnd = candidate.lastIndexOf('}');
  if (objStart !== -1 && objEnd !== -1 && objEnd > objStart) {
    const slice = candidate.slice(objStart, objEnd + 1);
    try {
      return JSON.parse(slice);
    } catch {
      return null;
    }
  }

  return null;
};

const normalizeToolName = (
  toolName: string,
  canonicalByLower: Map<string, string>
): string | null => {
  const trimmed = toolName.trim();
  if (!trimmed) return null;
  return canonicalByLower.get(trimmed.toLowerCase()) ?? null;
};

const parseToolNames = (
  raw: string,
  availableTools: ToolCatalogItem[]
): string[] => {
  const parsed = tryParseJson(raw);
  if (!parsed) return [];

  const canonicalByLower = new Map<string, string>();
  for (const t of availableTools) {
    canonicalByLower.set(t.name.toLowerCase(), t.name);
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
    }

    return selected;
  };

  if (Array.isArray(parsed)) {
    return fromArray(parsed);
  }

  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const toolsValue = (parsed as { tools?: unknown }).tools;
    if (Array.isArray(toolsValue)) {
      return fromArray(toolsValue);
    }
  }

  return [];
};

const buildToolCatalogText = (tools: ToolCatalogItem[]) => {
  if (!tools.length) return '';
  const lines = tools.map(tool => `- ${tool.name}: ${normalizeWhitespace(tool.description || '')}`);
  return lines.join('\n');
};

export const selectToolsWithAgent = async (params: {
  messages: ToolSelectionMessage[];
  availableTools: ToolCatalogItem[];
}): Promise<string[]> => {
  const toolModel = getToolModel();
  if (!toolModel) {
    return [];
  }

  const transcript = buildTranscript(params.messages);
  if (!transcript.trim() || params.availableTools.length === 0) {
    return [];
  }

  const toolCatalogText = buildToolCatalogText(params.availableTools);
  const prompt =
    'Tool catalog (choose only from these exact names):\n' +
    `${toolCatalogText}\n\n` +
    'Conversation (most recent last):\n' +
    `${transcript}\n\n` +
    'Return ONLY a JSON array of tool names.\n';

  const agent = new SimpleAgent({
    enabled: true,
    providerType: toolModel.providerType,
    model: toolModel.model,
    systemPrompt: SYSTEM_PROMPT,
    temperature: 0,
    maxTokens: MAX_OUTPUT_TOKENS,
    maxIterations: 1,
    enableTools: false,
    enableMemory: false,
  });

  try {
    const result = await agent.generate(prompt);
    return parseToolNames(result.response || '', params.availableTools);
  } catch (error) {
    console.warn('[ToolSelection] selection failed:', error);
    return [];
  }
};

