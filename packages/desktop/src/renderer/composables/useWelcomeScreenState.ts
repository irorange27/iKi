import { computed, onMounted, onUnmounted, ref, type Ref } from 'vue';

import type { Provider } from '@iki/backend/types/provider';
import { parseModelList } from '@iki/backend/utils/provider_models';
import { resolveProviderSelection } from './useChatProviderSelection';
import { useI18n } from '../i18n';
import { getProviderDisplayName } from '../modules/providers/provider_display';
import { getElectronApiMethod, getOptionalElectronAPI } from '../services/electron_api';

export const useWelcomeScreenState = (params: {
  activeModel: Readonly<Ref<string | undefined>>;
  activeProviderId: Readonly<Ref<string | null | undefined>>;
  onComposeStarter: (text: string) => void;
}) => {
  const electronAPI = getOptionalElectronAPI();
  const openSettingsWindow = getElectronApiMethod('openSettings');
  const { t } = useI18n();

  const providers = ref<Provider[]>([]);
  const configuredProviderIds = ref<string[]>([]);
  const isLoadingSetup = ref(true);
  let removeProviderListener: (() => void) | null = null;

  const loadProviderState = async () => {
    isLoadingSetup.value = true;

    try {
      const listedProviders = await electronAPI?.providers?.list?.();
      providers.value = Array.isArray(listedProviders) ? listedProviders : [];

      const enabledProviders = providers.value.filter(provider => provider.enabled);
      const configurationChecks = await Promise.all(
        enabledProviders.map(async provider => {
          try {
            if (typeof electronAPI?.chat?.isProviderConfigured === 'function') {
              return {
                id: provider.id,
                configured: await electronAPI.chat.isProviderConfigured(provider.type, provider.id),
              };
            }
          } catch {
            return { id: provider.id, configured: false };
          }
          return {
            id: provider.id,
            configured: typeof provider.api_key === 'string' && provider.api_key.trim().length > 0,
          };
        })
      );

      configuredProviderIds.value = configurationChecks
        .filter(result => result.configured)
        .map(result => result.id);
    } catch {
      providers.value = [];
      configuredProviderIds.value = [];
    } finally {
      isLoadingSetup.value = false;
    }
  };

  const configuredProviders = computed(() =>
    providers.value.filter(
      provider => provider.enabled && configuredProviderIds.value.includes(provider.id)
    )
  );

  const currentConfiguredProvider = computed(
    () =>
      configuredProviders.value.find(provider => provider.id === params.activeProviderId.value) ??
      null
  );

  const resolvedSelection = computed(() =>
    resolveProviderSelection({
      providers: configuredProviders.value,
      currentProvider: currentConfiguredProvider.value,
      currentModel: params.activeModel.value ?? '',
      preferredModel: params.activeModel.value ?? '',
      preferredProviderId: params.activeProviderId.value ?? '',
    })
  );

  const readyProvider = computed(() => resolvedSelection.value.selectedProvider);
  const readyProviderName = computed(() =>
    readyProvider.value ? getProviderDisplayName(readyProvider.value) : ''
  );
  const readyModel = computed(() => resolvedSelection.value.selectedModel.trim());
  const hasConfiguredProvider = computed(() => configuredProviders.value.length > 0);
  const hasReadyModel = computed(() => readyModel.value.length > 0);
  const isReadyToChat = computed(() => hasConfiguredProvider.value && hasReadyModel.value);

  const readyContextLabel = computed(() => {
    if (!isReadyToChat.value || !readyProviderName.value || !readyModel.value) return '';
    return `${readyProviderName.value} · ${readyModel.value}`;
  });

  const starterPrompts = computed(() => [
    t('chat.welcome.prompt.project'),
    t('chat.welcome.prompt.paste'),
  ]);

  const openSettingsOverview = () => {
    openSettingsWindow?.();
  };

  const focusBlankDraft = () => {
    params.onComposeStarter('');
  };

  onMounted(async () => {
    await loadProviderState();

    if (typeof electronAPI?.providers?.onUpdated === 'function') {
      removeProviderListener = electronAPI.providers.onUpdated(() => {
        void loadProviderState();
      });
    }
  });

  onUnmounted(() => {
    removeProviderListener?.();
  });

  return {
    focusBlankDraft,
    isReadyToChat,
    openSettingsOverview,
    readyContextLabel,
    starterPrompts,
  };
};
