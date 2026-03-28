import { describe, expect, it, vi } from 'vitest';
import { nextTick, ref } from 'vue';

const { loggerEventMock } = vi.hoisted(() => ({
  loggerEventMock: vi.fn(),
}));

vi.mock('../../../src/renderer/logger', () => ({
  createLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    event: loggerEventMock,
    span: vi.fn(),
  })),
}));

import { useChatComposerSend } from '../../../src/renderer/composables/useChatComposerSend';
import type { Provider } from '../../../src/shared/types/provider';

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

const createHarness = (options?: {
  message?: string;
  providerReady?:
    | {
        ok: true;
        provider: Provider;
        model: string;
      }
    | {
        ok: false;
        message: string;
      };
  prepareMessageSend?: ReturnType<typeof vi.fn>;
  stopStreamResult?: { success?: boolean; error?: string };
}) => {
  const message = ref(options?.message ?? 'Need help');
  const isRecording = ref(false);
  const isTranscribing = ref(false);
  const selectedTools = ref<string[]>([]);
  const selectedMcpServerIds = ref<string[]>([]);
  const selectedSkillIds = ref<string[]>([]);
  const isAutoToolMode = ref(true);
  const isAutoSkillMode = ref(true);
  const provider = buildProvider({
    id: 'openai',
    name: 'OpenAI',
    type: 'openai',
    models: '["gpt-4.1"]',
  });
  const ensureProviderReady = vi.fn(
    async () =>
      options?.providerReady ??
      ({
        ok: true,
        provider,
        model: 'gpt-4.1',
      } as const)
  );
  const resolveSelectedMcpServerIds = vi.fn(async () => []);
  const prepareMessageSend =
    options?.prepareMessageSend ??
    vi.fn(async () => ({
      threadId: 'thread_1',
      messagesSnapshot: [
        {
          id: 'user_1',
          role: 'user',
          parts: [{ type: 'text', text: message.value }],
        },
      ],
    }));
  const stopVoiceInput = vi.fn();
  const stream = vi.fn(async () => ({ success: true }));
  const stopStream = vi.fn(async () => options?.stopStreamResult ?? { success: true });

  const state = useChatComposerSend({
    electronAPI: {
      chat: {
        stream,
        stopStream,
      },
    } as never,
    message,
    isRecording,
    isTranscribing,
    selectedTools,
    selectedMcpServerIds,
    selectedSkillIds,
    isAutoToolMode,
    isAutoSkillMode,
    prepareFailedMessage: 'Prepare failed',
    stopFailedMessage: 'Stop failed',
    prepareMessageSend,
    ensureProviderReady,
    resolveSelectedMcpServerIds,
    stopVoiceInput,
  });

  return {
    message,
    ensureProviderReady,
    resolveSelectedMcpServerIds,
    prepareMessageSend,
    stopVoiceInput,
    stream,
    stopStream,
    state,
  };
};

describe('useChatComposerSend', () => {
  it('surfaces provider readiness failures without calling prepare or stream', async () => {
    const harness = createHarness({
      providerReady: {
        ok: false,
        message: 'Please configure OpenAI first.',
      },
    });

    await harness.state.sendMessage();

    expect(harness.prepareMessageSend).not.toHaveBeenCalled();
    expect(harness.stream).not.toHaveBeenCalled();
    expect(harness.state.composerFeedback.value).toBe('Please configure OpenAI first.');

    harness.message.value = 'Need help now';
    await nextTick();

    expect(harness.state.composerFeedback.value).toBe('');
  });

  it('surfaces stop failures inline and clears the loading flags', async () => {
    const harness = createHarness({
      stopStreamResult: {
        success: false,
        error: 'Bridge refused stop',
      },
    });
    harness.state.isLoading.value = true;

    await harness.state.stopStreaming();

    expect(harness.stopStream).toHaveBeenCalledTimes(1);
    expect(harness.state.composerFeedback.value).toBe('Bridge refused stop');
    expect(harness.state.isLoading.value).toBe(false);
    expect(harness.state.isStopping.value).toBe(false);
    expect(loggerEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'warn',
        event: 'chat.stream.stop',
        outcome: 'failed',
      })
    );
  });
});
