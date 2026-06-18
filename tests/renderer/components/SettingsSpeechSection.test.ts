// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

import SettingsSpeechSection from '../../../packages/desktop/src/renderer/components/settings/SettingsSpeechSection.vue';
import { useConfigStore } from '../../../packages/desktop/src/renderer/store/config';
import { createDefaultAppConfig } from '@iki/backend/config/defaults';
import type {
  WhisperNodeDownloadProgress,
  WhisperNodeModelInfo,
} from '@iki/core/types/speech';

const setElectronApi = (api: unknown) => {
  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    value: api,
  });
};

const findLabelByText = (wrapper: VueWrapper, text: string) => {
  const match = wrapper
    .findAll('label')
    .find(label => label.text().replace(/\s+/g, ' ').includes(text));

  if (!match) {
    throw new Error(`Label not found: ${text}`);
  }

  return match;
};

const findModelRow = (wrapper: VueWrapper, modelName: string) => {
  const match = wrapper
    .findAll('.speech-model-row')
    .find(row => row.text().replace(/\s+/g, ' ').includes(modelName));

  if (!match) {
    throw new Error(`Whisper model row not found: ${modelName}`);
  }

  return match;
};

const selectSettingsOption = async (wrapper: VueWrapper, labelText: string, optionText: string) => {
  const label = findLabelByText(wrapper, labelText);
  await label.find('.settings-select-trigger').trigger('click');
  await flushPromises();

  const option = label
    .findAll('.settings-select-option')
    .find(candidate => candidate.text().replace(/\s+/g, ' ').includes(optionText));

  if (!option) {
    throw new Error(`Option not found for "${labelText}": ${optionText}`);
  }

  await option.trigger('click');
  await flushPromises();
};

const buildModel = (
  overrides: Partial<WhisperNodeModelInfo> & Pick<WhisperNodeModelInfo, 'name'>
): WhisperNodeModelInfo => ({
  name: overrides.name,
  fileName: overrides.fileName ?? `${overrides.name}.bin`,
  sizeMB: overrides.sizeMB ?? 142,
  ramGB: overrides.ramGB ?? 1,
  downloaded: overrides.downloaded ?? false,
  status: overrides.status ?? (overrides.downloaded ? 'ready' : 'missing'),
  error: overrides.error,
});

const mountSettingsSpeechSection = async (options?: {
  status?: Record<string, unknown>;
  models?: WhisperNodeModelInfo[];
  listModelsMock?: () => Promise<WhisperNodeModelInfo[]>;
  setupStore?: (store: ReturnType<typeof useConfigStore>) => void;
  downloadModel?: (modelName: string) => Promise<{ success: boolean; error?: string }>;
}) => {
  const pinia = createPinia();
  setActivePinia(pinia);

  let progressHandler: ((payload: WhisperNodeDownloadProgress) => void) | undefined;
  const listModels = vi.fn(options?.listModelsMock ?? (async () => options?.models ?? []));
  const downloadModel = vi.fn(
    options?.downloadModel ?? (async () => ({ success: true as const }))
  );
  const getStatus = vi.fn(async () => ({
    available: true,
    enabled: true,
    providerType: 'openai',
    model: 'whisper-1',
    ...(options?.status ?? {}),
  }));

  setElectronApi({
    speech: {
      getStatus,
      listModels,
      downloadModel,
      removeAllListeners: vi.fn(),
      onDownloadProgress: vi.fn((handler: (payload: WhisperNodeDownloadProgress) => void) => {
        progressHandler = handler;
        return () => undefined;
      }),
    },
  });

  const store = useConfigStore();
  store.config = createDefaultAppConfig();
  store.config.speech.enabled = true;
  options?.setupStore?.(store);

  const wrapper = mount(SettingsSpeechSection, {
    props: {
      active: true,
    },
    global: {
      plugins: [pinia],
      stubs: {
        RefreshCw: true,
      },
    },
  });

  await flushPromises();

  return { wrapper, store, getStatus, listModels, downloadModel, emitProgress: progressHandler };
};

describe('SettingsSpeechSection', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    Reflect.deleteProperty(window, 'electronAPI');
  });

  it('switches to whisper-node, emits config-change, and defaults the model to base.en', async () => {
    const models = [buildModel({ name: 'base.en', downloaded: true })];
    const { wrapper, store, listModels } = await mountSettingsSpeechSection({
      models,
    });

    await selectSettingsOption(wrapper, 'Provider', 'whisper-node (Local)');

    expect(store.config.speech.providerType).toBe('whisper-node');
    expect(store.config.speech.model).toBe('base.en');
    expect(listModels).toHaveBeenCalledTimes(1);
    expect(wrapper.emitted('config-change')).toHaveLength(2);
    expect(wrapper.text()).toContain('Download Models');
  });

  it('applies a downloaded whisper model and clears a custom model path', async () => {
    const { wrapper, store } = await mountSettingsSpeechSection({
      models: [
        buildModel({ name: 'base.en', downloaded: true }),
        buildModel({ name: 'small.en', downloaded: true }),
      ],
      setupStore: speechStore => {
        speechStore.config.speech.providerType = 'whisper-node';
        speechStore.config.speech.model = 'custom-model';
        speechStore.config.speech.modelPath = '/tmp/custom-model.bin';
      },
    });

    const row = findModelRow(wrapper, 'small.en');
    await row.find('button').trigger('click');
    await flushPromises();

    expect(store.config.speech.providerType).toBe('whisper-node');
    expect(store.config.speech.modelPath).toBe('');
    expect(store.config.speech.model).toBe('small.en');
    expect(wrapper.emitted('config-change')).toHaveLength(1);
  });

  it('shows download progress and switches to a model after a successful download', async () => {
    let resolveDownload:
      | ((value: { success: boolean; error?: string }) => void)
      | undefined;

    const initialModel = buildModel({ name: 'tiny.en', downloaded: false });
    const downloadedModel = buildModel({ name: 'tiny.en', downloaded: true });

    const { wrapper, store, downloadModel, emitProgress } = await mountSettingsSpeechSection({
      listModelsMock: vi
        .fn(async () => [initialModel])
        .mockResolvedValueOnce([initialModel])
        .mockResolvedValue([downloadedModel]),
      setupStore: speechStore => {
        speechStore.config.speech.providerType = 'whisper-node';
        speechStore.config.speech.model = 'base.en';
      },
      downloadModel: modelName =>
        new Promise(resolve => {
          resolveDownload = result => resolve(result);
          void modelName;
        }),
    });

    const row = findModelRow(wrapper, 'tiny.en');
    await row.find('button').trigger('click');
    await flushPromises();

    expect(downloadModel).toHaveBeenCalledWith('tiny.en');

    emitProgress?.({
      model: 'tiny.en',
      stage: 'downloading',
      progress: 0.5,
      downloadedBytes: 50 * 1024 * 1024,
      totalBytes: 100 * 1024 * 1024,
    });
    await flushPromises();

    expect(wrapper.text()).toContain('Downloading tiny.en');
    expect(wrapper.text()).toContain('50%');

    resolveDownload?.({ success: true });
    await flushPromises();
    await vi.advanceTimersByTimeAsync(400);
    await flushPromises();

    expect(store.config.speech.model).toBe('tiny.en');
    expect(store.config.speech.modelPath).toBe('');
    expect(wrapper.text()).toContain('Selected');
  });
});
