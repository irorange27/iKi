import {
  normalizeWhitespace,
  selectCatalogWithAgent,
  tryParseJson,
  type SelectionMessage,
} from './catalog_selection';

export type SkillSelectionMessage = SelectionMessage;

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
  return selectCatalogWithAgent({
    messages: params.messages,
    availableCatalog: params.availableSkills,
    buildCatalogText: buildSkillCatalogText,
    buildPrompt: (catalogText, transcript) =>
      'Skill catalog (choose only from these exact ids):\n' +
      `${catalogText}\n\n` +
      'Conversation (most recent last):\n' +
      `${transcript}\n\n` +
      'Return ONLY a JSON array of skill ids.\n',
    parseSelection: (raw, catalog) => parseSkillIds(raw, catalog),
    systemPrompt: SYSTEM_PROMPT,
    maxMessages: MAX_MESSAGES,
    maxInputChars: MAX_INPUT_CHARS,
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    logLabel: 'SkillSelection',
  });
};
