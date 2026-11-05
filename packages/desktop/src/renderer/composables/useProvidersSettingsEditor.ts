import { computed, ref, type Ref } from 'vue';

import { useI18n } from '../i18n';
import { createLogger } from '../logger';
import { toPlainData } from '@iki/core/utils/plain_clone';
import { getElectronAPI } from '../services/electron_api';
import type { ProviderRecord } from './useProviderDrafts';
import type {
  EditableProvider,
  EditableProviderApiFormat,
  ProviderSelectOption,
} from '../components/settings/providers/provider_settings_shared';

const providersSettingsEditorLogger = createLogger({ module: 'providers_settings_editor' });

export const useProvidersSettingsEditor = (params: {
  providers: Ref<ProviderRecord[]>;
  loadProviders: () => Promise<void>;
}) => {
  const electronAPI = getElectronAPI();
  const { t } = useI18n();

  const editingProvider = ref<EditableProvider | null>(null);
  const showProviderEditor = ref(false);

  const providerTypeOptions = computed<ProviderSelectOption[]>(() => [
    { value: 'deepseek', label: t('settings.providers.type.deepseek') },
    { value: 'openai-compatible', label: t('settings.providers.type.openaiCompatible') },
    { value: 'anthropic-compatible', label: t('settings.providers.type.anthropicCompatible') },
    { value: 'google', label: t('settings.providers.type.googleGemini') },
    { value: 'ollama', label: 'Ollama' },
    { value: 'custom', label: t('common.custom') },
  ]);

  const editingProviderApiFormat = computed<EditableProviderApiFormat | null>(() => {
    const providerType = editingProvider.value?.type?.trim();
    if (!providerType) return null;

    if (providerType === 'anthropic-compatible') {
      return {
        value: 'messages',
        options: [
          {
            value: 'messages',
            label: t('settings.providers.modal.apiFormat.messages'),
          },
        ],
        endpoint: t('settings.providers.modal.apiFormat.messages'),
        description: t('settings.providers.modal.apiFormat.anthropicDescription'),
        note: t('settings.providers.modal.apiFormat.anthropicAdapter'),
        locked: true,
      };
    }

    const isResponseApi = editingProvider.value?.isResponseApi === true;
    const usesOpenAICompatibleType = providerType === 'openai-compatible';
    const value = isResponseApi ? 'responses' : 'chat-completions';
    const options = [
      {
        value: 'responses' as const,
        label: t('settings.providers.modal.apiFormat.responses'),
      },
      {
        value: 'chat-completions' as const,
        label: t('settings.providers.modal.apiFormat.chatCompletions'),
      },
    ];

    if (isResponseApi) {
      return {
        value,
        options,
        endpoint: t('settings.providers.modal.apiFormat.responses'),
        description: t('settings.providers.modal.apiFormat.responsesDescription'),
        note: t('settings.providers.modal.apiFormat.responsesAdapter'),
        locked: false,
      };
    }

    return {
      value,
      options,
      endpoint: t('settings.providers.modal.apiFormat.chatCompletions'),
      description: usesOpenAICompatibleType
        ? t('settings.providers.modal.apiFormat.openaiDescription')
        : t('settings.providers.modal.apiFormat.defaultDescription'),
      note: usesOpenAICompatibleType
        ? t('settings.providers.modal.apiFormat.chatCompletionsAdapter')
        : t('settings.providers.modal.apiFormat.defaultAdapter'),
      locked: false,
    };
  });

  const addCustomProvider = () => {
    editingProvider.value = {
      id: `custom_${Date.now()}`,
      name: '',
      type: 'custom',
      apiKey: '',
      models: '',
      baseUrl: '',
      enabled: true,
      isResponseApi: true,
    };
    showProviderEditor.value = true;
  };

  const updateEditingProviderTypeSelection = (value: string) => {
    if (!editingProvider.value) return;
    editingProvider.value.type = value;
    if (value === 'anthropic-compatible') {
      editingProvider.value.isResponseApi = false;
    }
  };

  const updateEditingProviderApiFormatSelection = (value: string) => {
    if (!editingProvider.value) return;
    editingProvider.value.isResponseApi = value === 'responses';
  };

  const saveProvider = async () => {
    if (!editingProvider.value) return;

    const modelsArray = editingProvider.value.models
      .split(',')
      .map(model => model.trim())
      .filter(Boolean);

    const providerData = {
      ...editingProvider.value,
      models: modelsArray,
      availableModels: modelsArray,
      isResponseApi:
        editingProvider.value.type === 'anthropic-compatible'
          ? false
          : editingProvider.value.isResponseApi === true,
    };

    try {
      // Same IPC-clone convention as the built-in provider save: strip the
      // reactive draft before it reaches the contextBridge boundary.
      if (params.providers.value.some(provider => provider.id === editingProvider.value?.id)) {
        await electronAPI.providers.update(editingProvider.value.id, toPlainData(providerData));
      } else {
        await electronAPI.providers.add(toPlainData(providerData));
      }
    } catch (error) {
      providersSettingsEditorLogger.event({
        level: 'error',
        event: 'providers.save',
        outcome: 'failed',
        error,
      });
      return;
    }

    showProviderEditor.value = false;
    editingProvider.value = null;
    await params.loadProviders();
  };

  return {
    addCustomProvider,
    editingProvider,
    editingProviderApiFormat,
    providerTypeOptions,
    saveProvider,
    showProviderEditor,
    updateEditingProviderApiFormatSelection,
    updateEditingProviderTypeSelection,
  };
};
