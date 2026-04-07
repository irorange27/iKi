import { describe, expect, it } from 'vitest';

import { createChatComposerStreamPayload } from '../../../../src/renderer/modules/chat/chat_send_transport';
import type { Provider } from '../../../../src/shared/types/provider';

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

describe('chat_send_transport', () => {
  it('builds the same IPC stream payload shape used by the composer send path', () => {
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
      preparedMessageSend: {
        threadId: 'thread_1',
        messagesSnapshot: [
          {
            id: 'user_1',
            role: 'user',
            parts: [{ type: 'text', text: 'Hello' }],
          },
        ],
      },
      isAutoToolMode: false,
      selectedTools: ['web'],
      resolvedMcpServerIds: ['docs_server'],
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
      messages: [
        {
          id: 'user_1',
          role: 'user',
          parts: [{ type: 'text', text: 'Hello' }],
        },
      ],
      tools: ['web'],
      mcpServerIds: ['docs_server'],
      skillMode: 'manual',
      skillIds: ['skill.docs'],
      threadId: 'thread_1',
    });
  });

  it('returns null when the prepared send snapshot has no transportable messages', () => {
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
        preparedMessageSend: {
          threadId: 'thread_1',
          messagesSnapshot: [],
        },
        isAutoToolMode: true,
        selectedTools: ['web'],
        resolvedMcpServerIds: [],
        isAutoSkillMode: true,
        selectedSkillIds: ['skill.docs'],
      })
    ).toBeNull();
  });
});
