import { describe, expect, it } from 'vitest';

import {
  buildTranscript,
  extractJsonCandidate,
  tryParseJson,
} from '../../../src/core/runtimes/catalog_selection_runtime';

describe('catalog_selection_runtime', () => {
  it('extracts trimmed JSON from fenced output', () => {
    expect(extractJsonCandidate('```json\n["web"]\n```')).toBe('["web"]');
  });

  it('treats empty fenced output as an empty candidate', () => {
    expect(extractJsonCandidate('```json\n   \n```')).toBe('');
    expect(extractJsonCandidate('```   \n```')).toBe('');
  });

  it('parses fenced object payloads and returns null for empty fenced output', () => {
    expect(tryParseJson('```json\n{ "tools": ["fetch"] }\n```')).toEqual({
      tools: ['fetch'],
    });
    expect(tryParseJson('```json\n   \n```')).toBeNull();
  });

  it('extracts embedded array or object JSON when the model wraps it in commentary', () => {
    expect(tryParseJson('Use these tools: ["web","fetch"] thanks')).toEqual(['web', 'fetch']);
    expect(tryParseJson('Answer: { "skills": ["user:my-skill"] } done')).toEqual({
      skills: ['user:my-skill'],
    });
  });

  it('builds a normalized transcript from the most recent messages within limits', () => {
    const transcript = buildTranscript(
      [
        { role: 'system', content: '  ignored by budget  ' },
        { role: 'user', content: 'first prompt' },
        { role: 'assistant', content: '   second\n\nreply   ' },
        { role: 'user', content: 'third request' },
      ],
      { maxMessages: 3, maxInputChars: 55 }
    );

    expect(transcript).toBe('Assistant: second reply\nUser: third request');
  });
});
