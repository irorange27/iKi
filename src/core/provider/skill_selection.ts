import { SimpleAgent } from '../agent';
import { getToolModel } from './tool_model';

export type SkillSelectionMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

export type SkillCatalogItem = {
  id: string;
  name: string;
  description: string;
  source?: string;
};

const MAX_INPUT_CHARS = 4500;
const MAX_MESSAGES = 16;
const MAX_OUTPUT_TOKENS = 240;
const MAX_SKILLS_SELECTED = 4;
const MAX_CATALOG_ITEMS = 80;

const SYSTEM_PROMPT =
  'You are a skill router for an AI assistant.\n' +
  'Your job: pick the minimal set of skills (instruction packs) that would materially improve the next response.\n' +
  'Rules:\n' +
  '- Output ONLY valid JSON.\n' +
  '- Prefer using NO skills when possible.\n' +
  `- Return a JSON array of skill ids. Example: ["user:my-skill","codex:.system/openai-docs"].\n` +
  '- If no skill is needed, return [].\n' +
  '- Never invent ids not present in the catalog.\n' +
  `- Choose at most ${MAX_SKILLS_SELECTED} skills.\n`;

const normalizeWhitespace = (value: string) => value.replace(/\s+/g, ' ').trim();

const formatRole = (role: SkillSelectionMessage['role']) =>
  role === 'assistant' ? 'Assistant' : role === 'system' ? 'System' : 'User';

const buildTranscript = (messages: SkillSelectionMessage[]) => {
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

const normalizeSkillId = (
  value: string,
  canonicalByLower: Map<string, string>
): string | null => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  return canonicalByLower.get(trimmed.toLowerCase()) ?? null;
};

const parseSkillIds = (raw: string, availableSkills: SkillCatalogItem[]): string[] => {
  const parsed = tryParseJson(raw);
  if (!parsed) return [];

  const canonicalByLower = new Map<string, string>();
  const nameToIdLower = new Map<string, string | null>();

  for (const skill of availableSkills) {
    canonicalByLower.set(skill.id.toLowerCase(), skill.id);

    const nameLower = (skill.name || '').trim().toLowerCase();
    if (nameLower) {
      const existing = nameToIdLower.get(nameLower);
      if (!existing) {
        nameToIdLower.set(nameLower, skill.id);
      } else if (existing !== skill.id) {
        nameToIdLower.set(nameLower, null);
      }
    }
  }

  for (const [nameLower, idOrNull] of nameToIdLower.entries()) {
    if (idOrNull) canonicalByLower.set(nameLower, idOrNull);
  }

  const fromArray = (values: unknown[]): string[] => {
    const selected: string[] = [];
    const seen = new Set<string>();

    for (const value of values) {
      if (typeof value !== 'string') continue;
      const normalized = normalizeSkillId(value, canonicalByLower);
      if (!normalized) continue;
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      selected.push(normalized);
      if (selected.length >= MAX_SKILLS_SELECTED) break;
    }

    return selected;
  };

  if (Array.isArray(parsed)) {
    return fromArray(parsed);
  }

  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const skillsValue = (parsed as { skills?: unknown; skillIds?: unknown }).skills;
    const skillIdsValue = (parsed as { skills?: unknown; skillIds?: unknown }).skillIds;

    if (Array.isArray(skillsValue)) {
      return fromArray(skillsValue);
    }
    if (Array.isArray(skillIdsValue)) {
      return fromArray(skillIdsValue);
    }
  }

  return [];
};

const buildSkillCatalogText = (skills: SkillCatalogItem[]) => {
  if (!skills.length) return '';
  const sliced = skills.slice(0, MAX_CATALOG_ITEMS);
  const lines = sliced.map(skill => {
    const source = skill.source ? ` [${skill.source}]` : '';
    const desc = normalizeWhitespace(skill.description || '');
    const name = normalizeWhitespace(skill.name || '');
    return `- ${skill.id}${source}: ${name}${desc ? ` - ${desc}` : ''}`;
  });
  return lines.join('\n');
};

export const selectSkillsWithAgent = async (params: {
  messages: SkillSelectionMessage[];
  availableSkills: SkillCatalogItem[];
}): Promise<string[]> => {
  const toolModel = getToolModel();
  if (!toolModel) {
    return [];
  }

  const transcript = buildTranscript(params.messages);
  if (!transcript.trim() || params.availableSkills.length === 0) {
    return [];
  }

  const skillCatalogText = buildSkillCatalogText(params.availableSkills);
  const prompt =
    'Skill catalog (choose only from these exact ids):\n' +
    `${skillCatalogText}\n\n` +
    'Conversation (most recent last):\n' +
    `${transcript}\n\n` +
    'Return ONLY a JSON array of skill ids.\n';

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
    return parseSkillIds(result.response || '', params.availableSkills);
  } catch (error) {
    console.warn('[SkillSelection] selection failed:', error);
    return [];
  }
};

