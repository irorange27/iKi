import { describe, expect, it, vi } from 'vitest';

import { CatalogSelectionAgent } from '../../../src/core/agents/catalog_selection_agent';
import type { CatalogSelectionRuntime } from '../../../src/core/runtimes/catalog_selection_runtime';

describe('CatalogSelectionAgent', () => {
  const makeRequest = () => ({
    messages: [{ role: 'user' as const, content: 'Use a tool if needed.' }],
    availableCatalog: [{ name: 'web' }],
    buildCatalogText: vi.fn().mockReturnValue('- web'),
    buildPrompt: vi.fn().mockReturnValue('prompt'),
    parseSelection: vi.fn().mockReturnValue(['web']),
    systemPrompt: 'router',
    maxMessages: 8,
    maxInputChars: 2000,
    maxOutputTokens: 120,
    logLabel: 'ToolSelection',
  });

  it('returns empty when the catalog is empty without invoking the runtime', async () => {
    const runtime: CatalogSelectionRuntime = {
      run: vi.fn(),
    };
    const agent = new CatalogSelectionAgent(runtime);

    const request = { ...makeRequest(), availableCatalog: [] as Array<{ name: string }> };

    await expect(agent.run(request)).resolves.toEqual([]);
    expect(runtime.run).not.toHaveBeenCalled();
  });

  it('delegates the selection request to the runtime', async () => {
    const runtime: CatalogSelectionRuntime = {
      run: vi.fn().mockResolvedValue(['web']),
    };
    const agent = new CatalogSelectionAgent(runtime);
    const request = makeRequest();

    await expect(agent.run(request)).resolves.toEqual(['web']);
    expect(runtime.run).toHaveBeenCalledWith(request);
  });
});
