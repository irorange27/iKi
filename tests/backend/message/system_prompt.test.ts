// @vitest-environment node

import { describe, expect, it } from 'vitest';

import {
  assembleRequestSystemPrompt,
  REQUEST_SYSTEM_PROMPT_SLOTS,
  type RequestSystemPromptPart,
} from '@iki/backend/message/system_prompt';

const part = (slot: RequestSystemPromptPart['slot'], text: string): RequestSystemPromptPart => ({
  slot,
  text,
});

describe('request system prompt assembly', () => {
  it('orders parts by the centrally owned slot table regardless of input order', () => {
    const { slots, prompt } = assembleRequestSystemPrompt([
      part('transcriptSystem', 'history system'),
      part('extraPrompt', 'aux prompt'),
      part('persona', 'identity, date, os'),
      part('planPrompt', 'mode prompt'),
    ]);

    expect(slots.map(s => s.slot)).toEqual(['persona', 'planPrompt', 'extraPrompt', 'transcriptSystem']);
    expect(prompt).toBe('identity, date, os\n\nmode prompt\n\naux prompt\n\nhistory system');
  });

  it('keeps input order among parts of the same slot (stable sort)', () => {
    const { slots, prompt } = assembleRequestSystemPrompt([
      part('persona', 'persona'),
      part('transcriptSystem', 'first system'),
      part('transcriptSystem', 'second system'),
      part('transcriptSystem', 'third system'),
    ]);

    expect(slots.map(s => s.text)).toEqual(['persona', 'first system', 'second system', 'third system']);
    expect(prompt).toBe('persona\n\nfirst system\n\nsecond system\n\nthird system');
  });

  it('drops empty and whitespace-only parts but preserves the bytes of kept parts', () => {
    const { slots, prompt } = assembleRequestSystemPrompt([
      part('persona', '  padded persona  '),
      part('planPrompt', '   '),
      part('extraPrompt', ''),
      part('transcriptSystem', 'kept'),
    ]);

    expect(slots).toEqual([
      { slot: 'persona', text: '  padded persona  ' },
      { slot: 'transcriptSystem', text: 'kept' },
    ]);
    expect(prompt).toBe('  padded persona  \n\nkept');
  });

  it('renders an empty string when every part is empty', () => {
    const { slots, prompt } = assembleRequestSystemPrompt([
      part('persona', ''),
      part('planPrompt', ' \n '),
    ]);

    expect(slots).toEqual([]);
    expect(prompt).toBe('');
  });

  it('exposes the slot table as the stable placement vocabulary', () => {
    const orders = Object.values(REQUEST_SYSTEM_PROMPT_SLOTS);
    expect([...orders].sort((a, b) => a - b)).toEqual(orders);
    expect(new Set(orders).size).toBe(orders.length);
  });
});
