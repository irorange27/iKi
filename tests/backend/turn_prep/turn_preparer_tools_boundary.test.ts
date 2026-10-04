import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const createModelMock = vi.hoisted(() => vi.fn());
const userDataMock = vi.hoisted(() => vi.fn(() => ''));
vi.mock('@iki/backend/platform', () => ({ getUserDataPath: userDataMock }));
vi.mock('@iki/backend/provider/llm/factory', async importOriginal => ({
  ...(await importOriginal<typeof import('@iki/backend/provider/llm/factory')>()),
  createModel: createModelMock,
  disposeLanguageModel: vi.fn(),
  resolvePersonaPrompt: () => 'boundary system',
  getModelGenerationSettings: () => ({}),
  resolveModelCapability: async () => ({
    contextWindow: 100000,
    maxInputTokens: 98000,
    maxOutputTokens: 2000,
  }),
}));

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { closeDatabase, initializeDatabase } from '@iki/backend/db/database';
import { createChatTurnPreparer } from '@iki/backend/turn_prep/turn_preparer';
import { startTurnHarness } from '@iki/backend/agent/harness';
import { FauxModelProvider, fauxText } from '@iki/backend/agent/testing/faux_model';
import { addWorkspace } from '@iki/backend/db/workspaces';
import { createTool, defaultToolRegistry } from '@iki/backend/tools';
import { z } from 'zod';

const memory = {
  onMessagePersisted: vi.fn(),
  injectMemoryIntoMessages: vi.fn((messages: unknown[]) => messages),
  getAffectContextMessage: () => '',
};

// F6 boundary: an explicit tools array is a caller capability upper bound.
// The preparer must not expand it — `tools: []` disables tools entirely and a
// non-empty explicit list may not gain shell — while auto mode (no tools
// param) keeps the desktop default of an always-exposed shell.
describe('turn preparer explicit tool upper bound', () => {
  let root: string;

  const makePreparer = () =>
    createChatTurnPreparer({
      memory: memory as never,
      getRuntimeConfig: () => ({
        emotion: null,
        memoryContext: null,
        autoApproveToolRequests: false,
      }),
      resolveSkillsSystemPrompt: async () => ({
        skillsSystemPrompt: '',
        usedSkills: [],
        skillMode: 'manual' as const,
      }),
      getAssistantProfileContextMessage: () => '',
      retrieveRelevantContinuity: () => null,
    });

  const prepare = async (options: Record<string, unknown>) =>
    makePreparer().prepareChatTurn({
      providerType: 'openai',
      model: 'boundary-model',
      skillIds: [],
      skillMode: 'manual',
      messages: [{ role: 'user', content: 'plain answer' }],
      ...options,
    } as never);

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'iki-turn-preparer-boundary-'));
    userDataMock.mockReturnValue(root);
    initializeDatabase({ dbPath: path.join(root, 'boundary.db') });
    addWorkspace({ id: 'ws_boundary', path: root, name: 'boundary' });
  });

  afterEach(async () => {
    defaultToolRegistry.remove('shell');
    defaultToolRegistry.remove('web_search');
    closeDatabase();
    await fs.rm(root, { recursive: true, force: true });
  });

  it('keeps tools disabled when the caller passes an explicit empty list', async () => {
    const prepared = await prepare({ tools: [] });
    expect(prepared.guardedTools).toEqual([]);
    expect(prepared.enableTools).toBe(false);
  });

  it('keeps an explicit non-empty list as the upper bound — no shell expansion', async () => {
    defaultToolRegistry.register(
      createTool({
        name: 'web_search',
        type: 'function',
        description: 'boundary web probe',
        paramSchema: z.object({}),
        handler: async () => 'searched',
      })
    );
    const prepared = await prepare({ tools: ['web_search'] });
    expect(prepared.guardedTools).toEqual(['web_search']);
    expect(prepared.enableTools).toBe(true);
  });

  it('keeps the auto-mode shell default when no tools param is provided', async () => {
    createModelMock.mockReturnValue(new FauxModelProvider([fauxText('shell')]));
    const prepared = await prepare({});
    expect(prepared.guardedTools).toContain('shell');
  });

  it('sends no tool schemas and runs no tools for an explicitly disabled send', async () => {
    // A registry entry named "shell" makes the old force-add behavior visible
    // at this boundary: with the old preparer the disabled turn still exposed
    // a schema and could have executed it.
    let shellExecutions = 0;
    defaultToolRegistry.register(
      createTool({
        name: 'shell',
        type: 'function',
        description: 'boundary shell probe',
        paramSchema: z.object({}),
        handler: async () => {
          shellExecutions += 1;
          return 'executed';
        },
      })
    );
    const prepared = await prepare({ tools: [] });
    const model = new FauxModelProvider([fauxText('plain done')]);
    const providerCalls = vi.spyOn(model, 'doStream');
    createModelMock.mockReturnValue(model);

    const harness = startTurnHarness({
      providerType: 'openai',
      model: 'boundary-model',
      systemPrompt: 'boundary system',
      enableTools: prepared.enableTools,
      enabledToolNames: prepared.guardedTools,
      availableSkillIds: prepared.selectedSkillIds,
      guardActive: false,
      maxIterations: 5,
    });
    let text = '';
    for await (const event of harness.turn({ prompt: prepared.prompt, history: prepared.history })) {
      if (event.event === 'done') text = event.output.text;
    }
    expect(text).toBe('plain done');
    expect(shellExecutions).toBe(0);
    expect(providerCalls).toHaveBeenCalledTimes(1);
    const callOptions = providerCalls.mock.calls[0][0] as { tools?: unknown[] };
    expect(callOptions.tools === undefined || callOptions.tools.length === 0).toBe(true);
  });
});
