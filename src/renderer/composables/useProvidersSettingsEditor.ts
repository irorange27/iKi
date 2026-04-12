import { computed, ref, type Ref } from 'vue';

import { useI18n } from '../i18n';
import { getElectronAPI } from '../services/electron_api';
import type { ProviderRecord } from './useProviderDrafts';
import type {
  EditableProvider,
  EditableProviderApiFormat,
  ProviderSelectOption,
} from '../components/settings/providers/provider_settings_shared';

export const useProvidersSettingsEditor = (params: {
  providers: Ref<ProviderRecord[]>;
  loadProviders: () => Promise<void>;
}) => {
  const electronAPI = getElectronAPI();
  const { t } = useI18n();

  const editingProvider = ref<EditableProvider | null>(null);
  const showProviderEditor = ref(false);

  const providerTypeOptions = computed<ProviderSelectOption[]>(() => [
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

    const isResponseApi = editingProvider.value?.is_response_api === true;
    const usesOpenAICompatibleType = providerType === 'openai-compatible';
    const value = isResponseApi ? 'responses' : 'chat-completions';
    const options = [
      {
        value: 'chat-completions' as const,
        label: t('settings.providers.modal.apiFormat.chatCompletions'),
      },
      {
        value: 'responses' as const,
        label: t('settings.providers.modal.apiFormat.responses'),
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
      api_key: '',
      models: '',
      base_url: '',
      enabled: true,
      is_response_api: false,
      available_models: '[]',
    };
    showProviderEditor.value = true;
  };

  const updateEditingProviderTypeSelection = (value: string) => {
    if (!editingProvider.value) return;
    editingProvider.value.type = value;
    if (value === 'anthropic-compatible') {
      editingProvider.value.is_response_api = false;
    }
  };

  const updateEditingProviderApiFormatSelection = (value: string) => {
    if (!editingProvider.value) return;
    editingProvider.value.is_response_api = value === 'responses';
  };

  const saveProvider = async () => {
    if (!editingProvider.value) return;

    const modelsInput = editingProvider.value.models;
    const modelsArray =
      typeof modelsInput === 'string' && modelsInput.includes(',')
        ? modelsInput
            .split(',')
            .map((model: string) => model.trim())
            .filter(Boolean)
        : modelsInput
          ? [modelsInput]
          : [];

    const providerData = {
      ...editingProvider.value,
      models: JSON.stringify(modelsArray),
      available_models: JSON.stringify(modelsArray),
      is_response_api:
        editingProvider.value.type === 'anthropic-compatible'
          ? false
          : editingProvider.value.is_response_api === true,
    };

    if (params.providers.value.some(provider => provider.id === editingProvider.value?.id)) {
      await electronAPI.providers.update(editingProvider.value.id, providerData);
    } else {
      await electronAPI.providers.add(providerData);
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
