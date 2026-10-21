import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const callPiChatMock = vi.hoisted(() => vi.fn());
const userDataMock = vi.hoisted(() => vi.fn(() => ''));
// The supply seam: Pi is the only executor (ADR 009). Scripting it here keeps
// these suites on the durable-layer behaviour they assert without reaching a
// network endpoint.
vi.mock('@iki/backend/provider/llm/pi_adapter', async importOriginal => ({
  ...(await importOriginal<typeof import('@iki/backend/provider/llm/pi_adapter')>()),
  callPiChat: callPiChatMock,
}));

vi.mock('@iki/backend/platform', () => ({ getUserDataPath: userDataMock }));
vi.mock('@iki/backend/provider/llm/factory', async importOriginal => ({
  ...(await importOriginal<typeof import('@iki/backend/provider/llm/factory')>()),
  disposeLanguageModel: vi.fn(),
  resolvePersonaPrompt: () => 'boundary system',
  getModelGenerationSettings: () => ({}),
  resolveModelCapability: async () => ({
    contextWindow: 100000,
    maxInputTokens: 98000,
    maxOutputTokens: 2000,
  }),
  // No database in this suite: answer the provider lookup directly so the Pi
  // supply admits the turn (the address is never dialled — callPiChat is mocked).
  getProviderConfig: () => ({
    type: 'openai',
    apiKey: 'key-test',
    baseURL: 'http://127.0.0.1:9/v1',
  }),
}));

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { closeDatabase, initializeDatabase } from '@iki/backend/db/database';
import { LoadSkillTool } from '@iki/backend/tools/skill_tools';
import { createChatTurnPreparer } from '@iki/backend/turn_prep/turn_preparer';
import { startPiTurnHarness } from '@iki/backend/agent/harness';
import { createScriptedPiChat } from '@iki/backend/agent/testing/scripted_pi';
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
    defaultToolRegistry.remove('handoff');
    defaultToolRegistry.remove('plan');
    defaultToolRegistry.remove('todo');
    defaultToolRegistry.remove('load_skill');
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
    callPiChatMock.mockImplementation(
      createScriptedPiChat([
        [
          { kind: 'text', text: 'shell' },
          { kind: 'done', reason: 'stop' },
        ],
      ])
    );
    const prepared = await prepare({});
    expect(prepared.guardedTools).toContain('shell');
  });

  it('keeps the explicit upper bound through the harness — control tools are not re-added', async () => {
    // The preparer honours the caller's bound; the resolver must not expand it
    // back. `todo` persists the thread's todo plan, `handoff` restarts the turn
    // as a new run segment, and `plan` only renders in-memory — but injecting
    // them behind an explicit `tools` list silently widens the caller's
    // capability: a daemon grant, a NapCat allow-list or `tools: ['read_file']`
    // can execute and persist planning turns it was never granted.
    // Register the loop-control tools the resolver used to inject, so the
    // expansion is observable on the wire exactly as it shipped.
    defaultToolRegistry.register(
      createTool({
        name: 'web_search',
        type: 'function',
        description: 'boundary web probe',
        paramSchema: z.object({}),
        handler: async () => 'searched',
      })
    );
    for (const name of ['handoff', 'plan', 'todo']) {
      defaultToolRegistry.register(
        createTool({
          name,
          type: 'function',
          description: `boundary control probe ${name}`,
          paramSchema: z.object({}),
          handler: async () => name,
        })
      );
    }
    const prepared = await prepare({
      tools: ['web_search'],
      threadId: 'thread_boundary',
      approvalPolicy: 'always',
    });
    expect(prepared.guardedTools).toEqual(['web_search']);

    callPiChatMock.mockImplementation(
      createScriptedPiChat([[{ kind: 'text', text: 'done' }, { kind: 'done' }]])
    );
    // `callPiChat(model, context, options)` — the sent tools live on `context`.
    const providerCalls = callPiChatMock;

    const harness = startPiTurnHarness({
      providerType: 'openai',
      model: 'boundary-model',
      systemPrompt: 'boundary system',
      enableTools: prepared.enableTools,
      enabledToolNames: prepared.guardedTools,
      availableSkillIds: prepared.selectedSkillIds,
      guardActive: false,
      // A disabled guard would normally broaden the resolved set.
      approvalPolicy: 'always',
      maxIterations: 5,
    });
    let text = '';
    for await (const event of harness.turn({
      prompt: prepared.prompt,
      history: prepared.history,
    })) {
      if (event.event === 'done') text = event.output.text;
    }
    expect(text).toBe('done');

    const callOptions = providerCalls.mock.calls[0][1] as {
      tools?: Record<string, { name?: string }> | Array<{ name?: string }>;
    };
    const sentToolNames = Array.isArray(callOptions.tools)
      ? callOptions.tools.map(tool => tool.name)
      : Object.keys(callOptions.tools ?? {});
    expect(sentToolNames).toEqual(['web_search']);
  });

  it('does not inject the skill loader behind a narrow grant', async () => {
    // `availableSkillIds` comes from the caller's `skillIds`, not from its
    // `tools` bound — a daemon caller can filter tools while passing a raw
    // skill id. Pushing `load_skill` whenever skills exist would widen that
    // grant, and bypass the approval policy with it.
    defaultToolRegistry.register(
      createTool({
        name: 'web_search',
        type: 'function',
        description: 'boundary web probe',
        paramSchema: z.object({}),
        handler: async () => 'searched',
      })
    );
    const prepared = await prepare({
      tools: ['web_search'],
      threadId: 'thread_boundary',
      approvalPolicy: 'never',
    });
    callPiChatMock.mockImplementation(
      createScriptedPiChat([[{ kind: 'text', text: 'done' }, { kind: 'done' }]])
    );
    // `callPiChat(model, context, options)` — the sent tools live on `context`.
    const providerCalls = callPiChatMock;

    const harness = startPiTurnHarness({
      providerType: 'openai',
      model: 'boundary-model',
      systemPrompt: 'boundary system',
      enableTools: prepared.enableTools,
      enabledToolNames: prepared.guardedTools,
      // Skills are available, but the caller did not grant the loader.
      availableSkillIds: ['skill_boundary'],
      guardActive: false,
      maxIterations: 5,
    });
    for await (const event of harness.turn({
      prompt: prepared.prompt,
      history: prepared.history,
    })) {
      if (event.event === 'done') expect(event.output.text).toBe('done');
    }

    const callOptions = providerCalls.mock.calls[0][1] as {
      tools?: Record<string, { name?: string }> | Array<{ name?: string }>;
    };
    const sentToolNames = Array.isArray(callOptions.tools)
      ? callOptions.tools.map(tool => tool.name)
      : Object.keys(callOptions.tools ?? {});
    expect(sentToolNames).toEqual(['web_search']);
  });

  it('grants the skill loader when the caller names it alongside its skills', async () => {
    defaultToolRegistry.register(
      createTool({
        name: 'web_search',
        type: 'function',
        description: 'boundary web probe',
        paramSchema: z.object({}),
        handler: async () => 'searched',
      })
    );
    defaultToolRegistry.register(new LoadSkillTool());
    const prepared = await prepare({
      tools: ['web_search', 'load_skill'],
      threadId: 'thread_boundary',
      approvalPolicy: 'never',
    });
    callPiChatMock.mockImplementation(
      createScriptedPiChat([[{ kind: 'text', text: 'done' }, { kind: 'done' }]])
    );
    // `callPiChat(model, context, options)` — the sent tools live on `context`.
    const providerCalls = callPiChatMock;

    const harness = startPiTurnHarness({
      providerType: 'openai',
      model: 'boundary-model',
      systemPrompt: 'boundary system',
      enableTools: prepared.enableTools,
      enabledToolNames: prepared.guardedTools,
      availableSkillIds: ['skill_boundary'],
      guardActive: false,
      maxIterations: 5,
    });
    for await (const event of harness.turn({
      prompt: prepared.prompt,
      history: prepared.history,
    })) {
      if (event.event === 'done') expect(event.output.text).toBe('done');
    }

    const callOptions = providerCalls.mock.calls[0][1] as {
      tools?: Record<string, { name?: string }> | Array<{ name?: string }>;
    };
    const sentToolNames = Array.isArray(callOptions.tools)
      ? callOptions.tools.map(tool => tool.name)
      : Object.keys(callOptions.tools ?? {});
    // Named and non-empty skills: the loader is granted by that name.
    expect(sentToolNames).toEqual(expect.arrayContaining(['web_search', 'load_skill']));
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
    callPiChatMock.mockImplementation(
      createScriptedPiChat([
        [
          { kind: 'text', text: 'plain done' },
          { kind: 'done', reason: 'stop' },
        ],
      ])
    );
    const providerCalls = callPiChatMock;

    const harness = startPiTurnHarness({
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
    for await (const event of harness.turn({
      prompt: prepared.prompt,
      history: prepared.history,
    })) {
      if (event.event === 'done') text = event.output.text;
    }
    expect(text).toBe('plain done');
    expect(shellExecutions).toBe(0);
    expect(providerCalls).toHaveBeenCalledTimes(1);
    const callOptions = providerCalls.mock.calls[0][1] as { tools?: unknown[] };
    expect(callOptions.tools === undefined || callOptions.tools.length === 0).toBe(true);
  });
});
