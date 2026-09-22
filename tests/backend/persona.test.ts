import { afterEach, describe, expect, it, vi } from 'vitest';

import { getPersonaPrompt } from '@iki/backend/persona';

describe('getPersonaPrompt', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  // The persona prompt is the head of the model's system prompt and sits in
  // front of the whole transcript, so any byte change invalidates the entire
  // KV-cache prefix. It may vary by day (the date matters to the model) but
  // never by second.
  it('is byte-stable across sub-day clock movement', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-22T10:00:00'));
    const first = getPersonaPrompt();

    vi.setSystemTime(new Date('2026-09-22T10:00:03'));

    expect(getPersonaPrompt()).toBe(first);
  });
});
