/**
 * User-selectable agent personalities (Codex-style /personality). A personality
 * is a communication-style block appended to the base system prompt; the base
 * persona and tool instructions stay untouched.
 */

export type PersonalityId = 'default' | 'concise' | 'friendly';

export const PERSONALITY_IDS: readonly PersonalityId[] = ['default', 'concise', 'friendly'];

const STYLE_BLOCKS: Record<Exclude<PersonalityId, 'default'>, string> = {
  concise: [
    'COMMUNICATION STYLE - Concise and pragmatic.',
    '- Lead with the answer or the action you took; skip preamble and pleasantries.',
    '- Keep prose tight: short paragraphs or bullet lists, no filler.',
    '- Do not restate the request or narrate obvious steps; surface only decisions, results, and risks.',
  ].join('\n'),
  friendly: [
    'COMMUNICATION STYLE - Warm and conversational.',
    '- Explain reasoning briefly as you go, in plain language.',
    '- Keep a friendly, encouraging tone without being verbose or repetitive.',
    '- Prefer approachable summaries over terse lists when presenting results.',
  ].join('\n'),
};

export const normalizePersonality = (value: unknown): PersonalityId | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return null;
  return (PERSONALITY_IDS as readonly string[]).includes(trimmed)
    ? (trimmed as PersonalityId)
    : null;
};

export const getPersonalityStylePrompt = (personality: unknown): string => {
  const normalized = normalizePersonality(personality);
  if (!normalized || normalized === 'default') return '';
  return STYLE_BLOCKS[normalized];
};
