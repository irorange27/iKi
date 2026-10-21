// @vitest-environment node

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@iki/backend/provider/llm/pi_adapter', async importOriginal => {
  const actual = await importOriginal<
    typeof import('@iki/backend/provider/llm/pi_adapter')
  >();
  return {
    ...actual,
    callPiChat: vi.fn(actual.callPiChat),
  };
});

import { closeDatabase, initializeDatabase } from '@iki/backend/db/database';
import { addProvider } from '@iki/backend/db/providers';
import { generateChatWithModelMessages } from '@iki/backend/provider/llm/factory';
import { callPiChat } from '@iki/backend/provider/llm/pi_adapter';
import { getPersonaPrompt } from '@iki/backend/persona';
import { createScriptedPiServer, sse, type ScriptedPiServer } from '../../pi_candidate/helpers/scripted_pi_server';

let root: string;
let server: ScriptedPiServer;

const usageChunk = () => ({
  prompt_tokens: 100,
  completion_tokens: 20,
  total_tokens: 120,
  prompt_tokens_details: { cached_tokens: 60 },
  completion_tokens_details: { reasoning_tokens: 5 },
});

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'iki-pi-generation-'));
  initializeDatabase({ dbPath: path.join(root, 'generation.db') });
  server = await createScriptedPiServer();
  addProvider({
    id: 'provider_pi_path',
    name: 'Pi-path provider',
    type: 'custom-openai',
    api_key: 'key-pi',
    models: '["pi-model"]',
    base_url: `http://127.0.0.1:${server.port}/v1`,
    enabled: 1,
  });

});

afterAll(async () => {
  await server.close();
  closeDatabase();
  await fs.rm(root, { recursive: true, force: true });
});

beforeEach(() => {
  vi.mocked(callPiChat).mockClear();
});

describe('switch item 1: single-shot generation routing', () => {
  it('routes the default openai-compatible branch through Pi — wire carries the prompt, usage maps to the total-prompt convention', async () => {
    server.setScript('pi generation probe', {
      chunks: [
        sse.delta('hello from pi'),
        sse.finish('stop', usageChunk()),
      ],
    });

    const result = await generateChatWithModelMessages({
      providerType: 'custom-openai',
      providerId: 'provider_pi_path',
      modelId: 'pi-model',
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'pi generation probe' }] },
      ],
      extraSystemPrompt: 'aux system prompt',
      maxOutputTokens: 777,
    });

    expect(result.text).toBe('hello from pi');
    expect(result.usage.inputTokens).toBe(100);
    expect(result.usage.outputTokens).toBe(20);
    expect(result.usage.cacheReadTokens).toBe(60);
    expect(result.usage.reasoningTokens).toBe(5);
    expect(result.usage.totalTokens).toBe(120);

    const wire = server.getWire('pi generation probe');
    const messages = wire.messages as Array<{ role: string; content: unknown }>;
    expect(messages[0].role).toBe('system');
    expect(JSON.stringify(messages[0].content)).toContain('aux system prompt');
    expect(JSON.stringify(wire.messages)).toContain('pi generation probe');
    expect(wire.max_tokens ?? wire.max_completion_tokens).toBe(777);
    expect(wire).not.toHaveProperty('strict');
    expect(wire.stream).toBe(true);
    expect(vi.mocked(callPiChat)).toHaveBeenCalledTimes(1);
    expect(server.countRequests('pi generation probe')).toBe(1);
  });

  it('out-of-domain history (multimodal part) falls back to the AI SDK branch (review B1)', async () => {
    addProvider({
      id: 'provider_pi_closed',
      name: 'Pi-eligible closed',
      type: 'custom-openai',
      api_key: 'key-pi',
      models: '["pi-model"]',
      base_url: 'http://127.0.0.1:9/v1',
      enabled: 1,
    });

    await expect(
      generateChatWithModelMessages({
        providerType: 'custom-openai',
        providerId: 'provider_pi_closed',
        modelId: 'pi-model',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'what is in this file?' },
              { type: 'file', data: new Uint8Array([1, 2, 3]), mediaType: 'application/pdf' },
            ],
          },
        ],
        extraSystemPrompt: 'aux system prompt',
      })
    ).rejects.toThrow();
    expect(vi.mocked(callPiChat)).not.toHaveBeenCalled();
    expect(server.countRequests('pi generation probe')).toBe(1);
  }, 15000);

  it('provider failures reject — the resolved Pi error message is not swallowed into an empty success', async () => {
    addProvider({
      id: 'provider_pi_error',
      name: 'Pi-eligible erroring',
      type: 'custom-openai',
      api_key: 'key-pi',
      models: '["pi-model"]',
      base_url: `http://127.0.0.1:${server.port}/v1`,
      enabled: true,
    });

    await expect(
      generateChatWithModelMessages({
        providerType: 'custom-openai',
        providerId: 'provider_pi_error',
        modelId: 'pi-model',
        messages: [{ role: 'user', content: [{ type: 'text', text: 'pi error probe' }] }],
      })
    ).rejects.toThrow(/no script for key/);
    expect(server.countRequests('pi error probe')).toBe(1);
  });

  it.each([
    ['openai', 'openai-responses'],
    ['anthropic', 'anthropic-messages'],
    ['anthropic-compatible', 'anthropic-messages'],
    ['minimax', 'anthropic-messages'],
    ['deepseek', 'openai-completions'],
  ])('serves a static-factory provider (%s) through Pi on the %s dialect', async (type, expectedApi) => {
    addProvider({
      id: `provider_static_${type}`,
      name: `Static ${type}`,
      type,
      api_key: 'key-static',
      models: '["static-model"]',
      base_url: `http://127.0.0.1:${server.port}/v1`,
      enabled: 1,
    } as never);

    server.setScript(`static probe ${type}`, {
      chunks: [sse.delta('ok'), sse.finish('stop', usageChunk())],
    });

    await generateChatWithModelMessages({
      providerType: type,
      providerId: `provider_static_${type}`,
      modelId: 'static-model',
      messages: [{ role: 'user', content: `static probe ${type}` }],
    }).catch(() => undefined);

    const model = vi.mocked(callPiChat).mock.calls.at(-1)?.[0];
    expect(model, `${type} must be admitted to the Pi supply`).toBeDefined();
    expect(model?.api).toBe(expectedApi);
  });

  it('lands the caller-declared aux instruction in the aux slot, never as a persona-led override', async () => {
    server.setScript('aux override probe', {
      chunks: [
        sse.delta('ok'),
        sse.finish('stop', usageChunk()),
      ],
    });

    const result = await generateChatWithModelMessages({
      providerType: 'custom-openai',
      providerId: 'provider_pi_path',
      modelId: 'pi-model',
      messages: [{ role: 'user', content: 'aux override probe' }],
      auxSystemInstruction: 'exact runtime system',
      temperature: 0.3,
    });
    expect(result.text).toBe('ok');

    const [model, context, options] = vi.mocked(callPiChat).mock.calls.at(-1)!;
    void model;
    expect(context.systemPrompt).toBe('exact runtime system');
    expect(JSON.stringify(context.systemPrompt)).not.toContain('persona');
    expect((options as { temperature?: number }).temperature).toBe(0.3);
    const wire = server.getWire('aux override probe');
    expect(JSON.stringify(wire.messages)).toContain('aux override probe');
  });

  it('carries a runtime-composed aux system exactly once, persona included', async () => {
    server.setScript('aux duplicate probe', {
      chunks: [sse.delta('ok'), sse.finish('stop', usageChunk())],
    });

    const composed = `${getPersonaPrompt()}\n\nAnswer the question briefly.`;
    await generateChatWithModelMessages({
      providerType: 'custom-openai',
      providerId: 'provider_pi_path',
      modelId: 'pi-model',
      messages: [{ role: 'user', content: 'aux duplicate probe' }],
      auxSystemInstruction: composed,
    });

    const wire = server.getWire('aux duplicate probe');
    const body = JSON.stringify(wire);
    const identityMarker = 'You are iKi, a powerful AI assistant';
    const occurrences = body.split(identityMarker).length - 1;
    expect(occurrences).toBe(1);
    expect(body).toContain('Answer the question briefly.');
  });

  it('serves a Responses provider through Pi with the openai-responses dialect', async () => {
    addProvider({
      id: 'provider_pi_responses',
      name: 'Responses provider',
      type: 'custom-responses',
      api_key: 'key-resp',
      models: '["resp-model"]',
      base_url: `http://127.0.0.1:${server.port}/v1`,
      enabled: 1,
      is_response_api: 1,
    } as never);

    server.setScript('responses dialect probe', {
      chunks: [sse.delta('hello from responses'), sse.finish('stop', usageChunk())],
    });

    const result = await generateChatWithModelMessages({
      providerType: 'custom-responses',
      providerId: 'provider_pi_responses',
      modelId: 'resp-model',
      messages: [{ role: 'user', content: 'responses dialect probe' }],
      extraSystemPrompt: 'resp system',
    }).catch(error => ({ text: '', error: error as Error }));

    const model = vi.mocked(callPiChat).mock.calls.at(-1)?.[0];
    if (model) {
      expect(model.api).toBe('openai-responses');
      expect(model.compat).not.toHaveProperty('supportsReasoningEffort');
    } else {
      throw new Error(
        `a Responses provider must be admitted to the Pi supply, got: ${JSON.stringify(
          'error' in result ? result.error?.message : 'no pi call'
        )}`
      );
    }
  });
});
