import { describe, expect, it } from 'vitest';

import { createChatComposerStreamPayload } from '../../../../packages/desktop/src/renderer/modules/chat/message_send_transport';
import type { Provider } from '@iki/backend/types/provider';

const buildProvider = (
  overrides: Partial<Provider> & Pick<Provider, 'id' | 'name' | 'type'>
): Provider => ({
  id: overrides.id,
  name: overrides.name,
  type: overrides.type,
  api_key: overrides.api_key ?? '',
  models: overrides.models ?? '[]',
  base_url: overrides.base_url,
  enabled: overrides.enabled ?? true,
  created_at: overrides.created_at ?? '2026-03-28T00:00:00.000Z',
  updated_at: overrides.updated_at ?? '2026-03-28T00:00:00.000Z',
  available_models: overrides.available_models ?? '[]',
  api_version: overrides.api_version,
  is_response_api: overrides.is_response_api,
  acp_command: overrides.acp_command,
  acp_args: overrides.acp_args,
  acp_mcp_server_ids: overrides.acp_mcp_server_ids,
  acp_auth_method_id: overrides.acp_auth_method_id,
  acp_api_provider_id: overrides.acp_api_provider_id,
  acp_model_mapping: overrides.acp_model_mapping,
});

describe('message_send_transport', () => {
  it('builds the invocation body (messages injected by the transport at send time)', () => {
    const provider = buildProvider({
      id: 'openai',
      name: 'OpenAI',
      type: 'openai',
      models: '["gpt-4.1"]',
    });

    const payload = createChatComposerStreamPayload({
      providerReady: {
        provider,
        model: 'gpt-4.1',
        modelCapability: {
          contextWindow: 128000,
          maxInputTokens: 128000,
          maxOutputTokens: 16384,
        },
      },
      threadId: 'thread_1',
      isAutoSkillMode: false,
      selectedSkillIds: ['skill.docs'],
    });

    expect(payload).toEqual({
      providerType: 'openai',
      providerId: 'openai',
      model: 'gpt-4.1',
      modelCapability: {
        contextWindow: 128000,
        maxInputTokens: 128000,
        maxOutputTokens: 16384,
      },
      skillMode: 'manual',
      skillIds: ['skill.docs'],
      threadId: 'thread_1',
    });
  });

  it('returns null without a thread id', () => {
    const provider = buildProvider({
      id: 'openai',
      name: 'OpenAI',
      type: 'openai',
    });

    expect(
      createChatComposerStreamPayload({
        providerReady: {
          provider,
          model: 'gpt-4.1',
        },
        threadId: '',
        isAutoSkillMode: true,
        selectedSkillIds: ['skill.docs'],
      })
    ).toBeNull();
  });

  it('includes a normalized reasoning effort only when one is selected', () => {
    const provider = buildProvider({
      id: 'openai',
      name: 'OpenAI',
      type: 'openai',
    });
    const base = {
      providerReady: { provider, model: 'gpt-5.2' },
      threadId: 'thread_1',
      isAutoSkillMode: true,
      selectedSkillIds: [],
    };

    const withEffort = createChatComposerStreamPayload({
      ...base,
      reasoningEffort: '  HIGH ',
    });
    expect(withEffort?.reasoningEffort).toBe('high');

    const withoutEffort = createChatComposerStreamPayload({ ...base, reasoningEffort: '' });
    expect(withoutEffort).not.toHaveProperty('reasoningEffort');
  });
});
