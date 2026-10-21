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

  it('provider failures reject — the resolved Pi error message is not swallowed into an empty success', async () => {
    // Pi delivers upstream failures as a RESOLVED error-stopReason result
    // (the event stream never rejects). The factory must surface them;
    // before the stopReason check this call resolved with empty text.
    addProvider({
      id: 'provider_pi_error',
      name: 'Pi-eligible erroring',
      type: 'custom-openai',
      api_key: 'key-pi',
      models: '["pi-model"]',
      base_url: `http://127.0.0.1:${server.port}/v1`,
      enabled: true,
    });

    // No script for this key → the scripted server answers HTTP 500.
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
    // Regression: `STATIC_PROVIDER_MODEL_FACTORIES[type]` used to EXCLUDE these
    // providers from the Pi supply, so openai/anthropic/minimax/deepseek rows
    // were served by per-provider AI SDK clients. Pi covers all three dialects;
    // what was missing was a single place that said which dialect a provider
    // type speaks. `resolveProviderApi` is now that place, and every Pi model
    // build carries its answer.
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

  it('honors systemPromptOverride and temperature on the Pi path (#126 aux consolidation)', async () => {
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
      systemPromptOverride: 'exact runtime system',
      temperature: 0.3,
    });
    expect(result.text).toBe('ok');

    // The override is the EXACT request system — the persona-led join is
    // skipped entirely (fails on the old code, which ignored the override);
    // the temperature rides into the adapter call.
    const [model, context, options] = vi.mocked(callPiChat).mock.calls.at(-1)!;
    void model;
    expect(context.systemPrompt).toBe('exact runtime system');
    expect(JSON.stringify(context.systemPrompt)).not.toContain('persona');
    expect((options as { temperature?: number }).temperature).toBe(0.3);
    const wire = server.getWire('aux override probe');
    expect(JSON.stringify(wire.messages)).toContain('aux override probe');
  });

  it('serves a Responses provider through Pi with the openai-responses dialect', async () => {
    // Regression: `isResponseApi` used to be an EXCLUSION from the Pi supply,
    // so Responses providers were pushed to the AI SDK's client.responses().
    // Pi drives that dialect natively (KnownApi includes "openai-responses"),
    // and the only thing missing was this adapter hardcoding
    // 'openai-completions'. The api kind must reach the built model.
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

    // Either the scripted server answers or the dialect path errored on its
    // own terms — what must NOT happen is a silent reroute to the AI SDK.
    // Routing is asserted on the built model, which is supply-agnostic.
    const model = vi.mocked(callPiChat).mock.calls.at(-1)?.[0];
    if (model) {
      expect(model.api).toBe('openai-responses');
      // The Responses compat shape has no reasoning-effort switch.
      expect(model.compat).not.toHaveProperty('supportsReasoningEffort');
    } else {
      // No Pi call means the request never reached the supply: report it.
      throw new Error(
        `a Responses provider must be admitted to the Pi supply, got: ${JSON.stringify(
          'error' in result ? result.error?.message : 'no pi call'
        )}`
      );
    }
  });
});
