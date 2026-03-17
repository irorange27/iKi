import { SimpleAgent } from '../agent';
import { getToolModel } from './tool_model';

export type SelectionMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

export const normalizeWhitespace = (value: string) => value.replace(/\s+/g, ' ').trim();

const formatRole = (role: SelectionMessage['role']) =>
  role === 'assistant' ? 'Assistant' : role === 'system' ? 'System' : 'User';

export const buildTranscript = (
  messages: SelectionMessage[],
  options: { maxMessages: number; maxInputChars: number }
) => {
  const recent = messages.slice(-options.maxMessages);
  const lines: string[] = [];
  let totalChars = 0;

  for (let i = recent.length - 1; i >= 0; i -= 1) {
    const msg = recent[i];
    const content = normalizeWhitespace(msg.content || '');
    if (!content) continue;

    const line = `${formatRole(msg.role)}: ${content}`;
    const nextLen = line.length + (lines.length > 0 ? 1 : 0);
    if (totalChars + nextLen > options.maxInputChars) break;
    lines.push(line);
    totalChars += nextLen;
  }

  return lines.reverse().join('\n');
};

export const extractJsonCandidate = (raw: string): string => {
  const trimmed = raw.trim();
  if (!trimmed) return '';

  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  return (fencedMatch && fencedMatch[1] ? fencedMatch[1].trim() : trimmed).trim();
};

export const tryParseJson = (raw: string): unknown => {
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

export type CatalogSelectorParams<T> = {
  messages: SelectionMessage[];
  availableCatalog: T[];
  buildCatalogText: (items: T[]) => string;
  buildPrompt: (catalogText: string, transcript: string) => string;
  parseSelection: (raw: string, items: T[]) => string[];
  systemPrompt: string;
  maxMessages: number;
  maxInputChars: number;
  maxOutputTokens: number;
  logLabel: string;
};

export const selectCatalogWithAgent = async <T>(
  params: CatalogSelectorParams<T>
): Promise<string[]> => {
  const toolModel = getToolModel();
  if (!toolModel) {
    return [];
  }

  const transcript = buildTranscript(params.messages, {
    maxMessages: params.maxMessages,
    maxInputChars: params.maxInputChars,
  });
  if (!transcript.trim() || params.availableCatalog.length === 0) {
    return [];
  }

  const catalogText = params.buildCatalogText(params.availableCatalog);
  const prompt = params.buildPrompt(catalogText, transcript);

  const agent = new SimpleAgent({
    enabled: true,
    providerType: toolModel.providerType,
    model: toolModel.model,
    systemPrompt: params.systemPrompt,
    temperature: 0,
    maxTokens: params.maxOutputTokens,
    maxIterations: 1,
    enableTools: false,
    enableMemory: false,
  });

  try {
    const result = await agent.generate(prompt);
    return params.parseSelection(result.response || '', params.availableCatalog);
  } catch (error) {
    console.warn(`[${params.logLabel}] selection failed:`, error);
    return [];
  }
};
