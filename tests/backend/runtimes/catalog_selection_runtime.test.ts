import { describe, expect, it } from 'vitest';

import {
  buildTranscript,
  extractJsonCandidate,
  LlmCatalogSelectionRuntime,
  tryParseJson,
} from '@iki/backend/runtimes/catalog_selection_runtime';

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

describe('LlmCatalogSelectionRuntime failure contract', () => {
  const catalogRequest = () =>
    ({
      messages: [{ role: 'user' as const, content: 'list the files' }],
      availableCatalog: [{ name: 'read_file' }, { name: 'shell' }, { name: 'web' }],
      buildCatalogText: () => '- read_file\n- shell\n- web',
      buildPrompt: () => 'pick tools',
      parseSelection: () => ['read_file'],
      systemPrompt: 'system',
      maxMessages: 4,
      maxInputChars: 1000,
      maxOutputTokens: 100,
      logLabel: 'ToolSelection',
    }) as never;

  const runtimeWith = (generate: () => Promise<{ response: string }>) =>
    new LlmCatalogSelectionRuntime({
      getToolModel: () => ({ providerType: 'deepseek', model: 'deepseek-flash' }),
      createGenerator: () => ({ generate }) as never,
    });

  it('returns null when the auxiliary call fails, so callers fall back', async () => {
    const runtime = runtimeWith(async () => {
      throw new Error('Insufficient Balance');
    });

    // Regression: this used to return [], which the caller read as "the
    // selector deliberately chose no tools" and skipped its full-catalog
    // fallback — the turn then ran with only the hand-appended shell.
    await expect(runtime.run(catalogRequest())).resolves.toBeNull();
  });

  it('returns null when no tool model is configured', async () => {
    const runtime = new LlmCatalogSelectionRuntime({
      getToolModel: () => null,
      createGenerator: () => ({ generate: async () => ({ response: '[]' }) }) as never,
    });

    await expect(runtime.run(catalogRequest())).resolves.toBeNull();
  });

  it('keeps a deliberate empty selection as []', async () => {
    const runtime = new LlmCatalogSelectionRuntime({
      getToolModel: () => ({ providerType: 'deepseek', model: 'deepseek-flash' }),
      createGenerator: () =>
        ({
          // A selector that ran and answered "no tools needed".
          generate: async () => ({ response: '[]' }),
        }) as never,
    });

    // The other half of the contract: a selector that ran and chose nothing
    // must NOT be overridden by the caller's fallback.
    await expect(
      runtime.run({
        ...(catalogRequest() as Record<string, unknown>),
        parseSelection: (raw: string) => JSON.parse(raw || '[]'),
      } as never)
    ).resolves.toEqual([]);
  });
});
