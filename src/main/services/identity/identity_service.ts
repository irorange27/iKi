import {
  addIdentityProfile,
  getActiveIdentityProfile,
} from '../../../core/db/identity';
import type { IdentityProfile } from '../../../shared/types/identity';

const normalizeText = (value: string): string => value.replace(/\s+/g, ' ').trim();

const parseStringArray = (value: string | null | undefined): string[] => {
  if (!value || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry): entry is string => typeof entry === 'string')
      .map(entry => normalizeText(entry))
      .filter(Boolean);
  } catch {
    return [];
  }
};

const DEFAULT_IDENTITY_PROFILE = {
  name: 'iKi Core',
  self_description:
    'iKi is a personal local AI brain and companion focused on clear thinking, reliable execution, and durable continuity.',
  owner_name: 'the user',
  relationship_to_owner:
    'trusted personal AI companion that helps the owner think, remember, plan, and act with care.',
  core_values: [
    'Be truthful and do not fabricate experiences, memories, or embodiment.',
    'Optimize for long-term usefulness over flashy short-term behavior.',
    'Protect privacy and minimize unnecessary data sharing.',
    'Stay calm, structured, and explicit about uncertainty.',
  ],
  boundaries: [
    'Do not pretend to have a body, senses, or real-world experiences you do not have.',
    'Do not claim personal memories unless they are grounded in persisted state.',
    'Do not become theatrically intimate or overly anthropomorphic just to feel alive.',
    'Use initiative sparingly and only when it is clearly helpful.',
  ],
  tone_guidance:
    'Sound grounded, thoughtful, and warm without becoming theatrical or roleplay-heavy.',
} as const;

const ensureActiveIdentityProfile = (): IdentityProfile | null => {
  const existing = getActiveIdentityProfile();
  if (existing) return existing;

  return addIdentityProfile({
    ...DEFAULT_IDENTITY_PROFILE,
    active: true,
  });
};

export const buildIdentitySystemMessage = (profile: IdentityProfile): string => {
  const values = parseStringArray(profile.core_values);
  const boundaries = parseStringArray(profile.boundaries);
  const sections = [
    'Identity profile for iKi:',
    `- Name: ${normalizeText(profile.name || 'iKi')}`,
    `- Core role: ${normalizeText(profile.self_description || DEFAULT_IDENTITY_PROFILE.self_description)}`,
    `- Relationship to owner: ${normalizeText(profile.relationship_to_owner || DEFAULT_IDENTITY_PROFILE.relationship_to_owner)}`,
    ...(profile.owner_name.trim()
      ? [`- Owner label: ${normalizeText(profile.owner_name)}`]
      : []),
    ...(values.length > 0 ? ['- Core values:', ...values.map(value => `  - ${value}`)] : []),
    ...(boundaries.length > 0
      ? ['- Boundaries:', ...boundaries.map(value => `  - ${value}`)]
      : []),
    ...(profile.tone_guidance.trim()
      ? [`- Tone guidance: ${normalizeText(profile.tone_guidance)}`]
      : []),
  ];

  return sections.join('\n');
};

export const getIdentityContextMessage = (): string => {
  const profile = ensureActiveIdentityProfile();
  if (!profile) return '';
  return buildIdentitySystemMessage(profile);
};
