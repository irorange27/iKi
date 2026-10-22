import { beforeEach, describe, expect, it, vi } from 'vitest';

const { generateChatWithModelMessagesMock, getModelGenerationSettingsMock, resolvePersonaPromptMock } =
  vi.hoisted(() => ({
    generateChatWithModelMessagesMock: vi.fn(),
    getModelGenerationSettingsMock: vi.fn(() => ({})),
    resolvePersonaPromptMock: vi.fn(() => 'persona prompt'),
  }));

vi.mock('@iki/backend/provider/llm/factory', async importOriginal => {
  const actual = await importOriginal<typeof import('@iki/backend/provider/llm/factory')>();
  return {
    ...actual,
    generateChatWithModelMessages: generateChatWithModelMessagesMock,
    getModelGenerationSettings: getModelGenerationSettingsMock,
    resolvePersonaPrompt: resolvePersonaPromptMock,
  };
});

import {
  buildTranscript,
  canonicalizeSelection,
  extractJsonCandidate,
  selectCatalog,
  tryParseJson,
} from '@iki/backend/runtimes/catalog_selection_runtime';

const toolModel = { providerType: 'deepseek', model: 'deepseek-flash' };

beforeEach(() => {
  vi.clearAllMocks();
});

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

describe('canonicalizeSelection', () => {
  const canonicalByLower = new Map([
    ['read_file', 'read_file'],
    ['shell', 'shell'],
  ]);

  it('maps a case-insensitive name to its canonical spelling', () => {
    expect(canonicalizeSelection(['READ_FILE', ' shell '], canonicalByLower, 6)).toEqual([
      'read_file',
      'shell',
    ]);
  });

  it('drops unknown names, non-strings, and blanks', () => {
    expect(canonicalizeSelection(['nope', 7, null, '  ', {}], canonicalByLower, 6)).toEqual([]);
  });

  it('keeps one entry per canonical name even when spellings differ', () => {
    expect(canonicalizeSelection(['read_file', 'READ_FILE', 'Read_File'], canonicalByLower, 6)).toEqual(
      ['read_file']
    );
  });

  it('stops at the selection cap', () => {
    expect(canonicalizeSelection(['read_file', 'shell'], canonicalByLower, 1)).toEqual(['read_file']);
  });
});

describe('selectCatalog failure contract', () => {
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

  it('returns null when the auxiliary call fails, so callers fall back', async () => {
    generateChatWithModelMessagesMock.mockRejectedValue(new Error('Insufficient Balance'));

    await expect(selectCatalog(catalogRequest(), () => toolModel)).resolves.toBeNull();
  });

  it('returns null when no tool model is configured, without calling the model', async () => {
    await expect(selectCatalog(catalogRequest(), () => null)).resolves.toBeNull();
    expect(generateChatWithModelMessagesMock).not.toHaveBeenCalled();
  });

  it('keeps a deliberate empty selection as []', async () => {
    generateChatWithModelMessagesMock.mockResolvedValue({ text: '[]' });

    await expect(
      selectCatalog(
        {
          ...(catalogRequest() as Record<string, unknown>),
          parseSelection: (raw: string) => JSON.parse(raw || '[]'),
        } as never,
        () => toolModel
      )
    ).resolves.toEqual([]);
  });
});
