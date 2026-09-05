import { describe, expect, it } from 'vitest';

import {
  getPersonalityStylePrompt,
  normalizePersonality,
} from '../../../packages/backend/src/chat/personality';

describe('personality', () => {
  it('normalizes known personality ids and rejects unknown ones', () => {
    expect(normalizePersonality('concise')).toBe('concise');
    expect(normalizePersonality('  FRIENDLY ')).toBe('friendly');
    expect(normalizePersonality('default')).toBe('default');
    expect(normalizePersonality('')).toBeNull();
    expect(normalizePersonality('sparkly')).toBeNull();
    expect(normalizePersonality(42)).toBeNull();
  });

  it('returns an empty style prompt for default/unknown values', () => {
    expect(getPersonalityStylePrompt('default')).toBe('');
    expect(getPersonalityStylePrompt('')).toBe('');
    expect(getPersonalityStylePrompt(undefined)).toBe('');
    expect(getPersonalityStylePrompt('sparkly')).toBe('');
  });

  it('returns a distinct non-empty style block per non-default personality', () => {
    const concise = getPersonalityStylePrompt('concise');
    const friendly = getPersonalityStylePrompt('friendly');

    expect(concise).toBeTruthy();
    expect(friendly).toBeTruthy();
    expect(concise).not.toBe(friendly);
    expect(concise).toContain('Concise');
    expect(friendly).toContain('conversational');
  });
});
