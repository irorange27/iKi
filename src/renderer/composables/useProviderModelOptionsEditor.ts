import { ref, type Ref } from 'vue';

import type { ProviderModelOptions } from '../../shared/types/provider';
import type { ProviderDraft } from './useProviderDrafts';
import type { ActiveModelOptionsEditor } from '../components/settings/providers/provider_settings_shared';

export const useProviderModelOptionsEditor = (params: {
  selectedProviderDraft: Readonly<Ref<ProviderDraft | null>>;
  selectedProviderId: Readonly<Ref<string | null>>;
}) => {
  const modelOptionsEditor = ref<ActiveModelOptionsEditor | null>(null);

  const openModelOptionsEditor = (modelId: string) => {
    if (!params.selectedProviderId.value || !params.selectedProviderDraft.value) return;

    modelOptionsEditor.value = {
      providerId: params.selectedProviderId.value,
      modelId,
    };
  };

  const closeModelOptionsEditor = () => {
    modelOptionsEditor.value = null;
  };

  const saveModelOptions = (payload: {
    providerId: string;
    modelId: string;
    options: ProviderModelOptions | null;
  }) => {
    if (
      !params.selectedProviderDraft.value ||
      params.selectedProviderId.value !== payload.providerId
    ) {
      return;
    }

    const nextModelOptions = {
      ...params.selectedProviderDraft.value.model_options,
    };

    if (payload.options) {
      nextModelOptions[payload.modelId] = payload.options;
    } else {
      delete nextModelOptions[payload.modelId];
    }

    params.selectedProviderDraft.value.model_options = nextModelOptions;
    closeModelOptionsEditor();
  };

  return {
    closeModelOptionsEditor,
    modelOptionsEditor,
    openModelOptionsEditor,
    saveModelOptions,
  };
};
