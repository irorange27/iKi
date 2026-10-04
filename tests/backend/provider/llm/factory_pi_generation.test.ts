// @vitest-environment node

/**
 * Switch item 1 (issue #104, ADR 007): single-shot generation for the
 * default openai-compatible branch routes through the Pi supply layer;
 * static-factory providers stay on the AI SDK. Both sides are exercised at
 * the real HTTP boundary (scripted SSE server).
 */
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
    // Total-prompt convention: inputTokens restores cached tokens (100 = 40 + 60).
    expect(result.usage.inputTokens).toBe(100);
    expect(result.usage.outputTokens).toBe(20);
    expect(result.usage.cacheReadTokens).toBe(60);
    expect(result.usage.reasoningTokens).toBe(5);
    expect(result.usage.totalTokens).toBe(120);

    // The wire: persona/aux system prompt present, user message present,
    // output cap projected, no strict normalization requested.
    const wire = server.getWire('pi generation probe');
    const messages = wire.messages as Array<{ role: string; content: unknown }>;
    expect(messages[0].role).toBe('system');
    expect(JSON.stringify(messages[0].content)).toContain('aux system prompt');
    expect(JSON.stringify(wire.messages)).toContain('pi generation probe');
    // Compat default for unknown baseUrls is the newer field name.
    expect(wire.max_tokens ?? wire.max_completion_tokens).toBe(777);
    expect(wire).not.toHaveProperty('strict');
    // Pi-path discriminator: streaming-shaped request, and the adapter call
    // actually happened (routing bites by assertion, not by protocol luck).
    expect(wire.stream).toBe(true);
    expect(vi.mocked(callPiChat)).toHaveBeenCalledTimes(1);
    expect(server.countRequests('pi generation probe')).toBe(1);
  });

  it('out-of-domain history (multimodal part) falls back to the AI SDK branch (review B1)', async () => {
    // The provider is Pi-eligible, but the history carries a file part —
    // outside the projection's covered domain. Per ADR decision 2 the
    // request must fall back to the AI SDK path — which fails fast on the
    // closed port — and callPiChat must never be invoked.
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
    // Per-key counting: immune to other tests' request pollution.
    expect(server.countRequests('pi generation probe')).toBe(1);
  }, 15000);

  it('static-factory providers stay on the AI SDK path — Pi never sees the request', async () => {
    // The static-factory provider keeps the AI SDK path: callPiChat is never
    // invoked and the request goes to the provider's own (closed) endpoint,
    // failing there — never on the Pi supply layer.
    addProvider({
      id: 'provider_static_closed',
      name: 'Static closed',
      type: 'openai',
      api_key: 'key-static',
      models: '["static-model"]',
      base_url: 'http://127.0.0.1:9/v1',
      enabled: 1,
    });

    await expect(
      generateChatWithModelMessages({
        providerType: 'openai',
        providerId: 'provider_static_closed',
        modelId: 'static-model',
        messages: [{ role: 'user', content: 'static probe' }],
      })
    ).rejects.toThrow();
    expect(vi.mocked(callPiChat)).not.toHaveBeenCalled();
    expect(server.countRequests('pi generation probe')).toBe(1); // unchanged
  }, 15000);
});
