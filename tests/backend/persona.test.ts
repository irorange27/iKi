import { afterEach, describe, expect, it, vi } from 'vitest';

import { getPersonaPrompt } from '@iki/backend/persona';

describe('getPersonaPrompt', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('is byte-stable across sub-day clock movement', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-22T10:00:00'));
    const first = getPersonaPrompt();

    vi.setSystemTime(new Date('2026-09-22T10:00:03'));

    expect(getPersonaPrompt()).toBe(first);
  });
});
