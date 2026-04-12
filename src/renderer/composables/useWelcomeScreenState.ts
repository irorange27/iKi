import { computed, onMounted, onUnmounted, ref, type Ref } from 'vue';

import type { Provider } from '../../shared/types/provider';
import { parseModelList } from '../../shared/utils/provider_models';
import { resolveProviderSelection } from './useChatProviderSelection';
import { useI18n } from '../i18n';
import { getProviderDisplayName } from '../modules/providers/provider_display';
import { getElectronApiMethod, getOptionalElectronAPI } from '../services/electron_api';

type OnboardingStep = {
  key: 'provider' | 'model' | 'message';
  title: string;
  detail: string;
  status: 'done' | 'active' | 'pending';
};

type WelcomeMilestone = {
  title: string;
  body: string;
};

type WelcomeContextSource = {
  title: string;
  body: string;
};

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
  const dismissedMilestoneStageKey = ref<string | null>(null);
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
            return {
              id: provider.id,
              configured: false,
            };
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
  const selectedProviderHasModels = computed(() => {
    if (!readyProvider.value) return false;
    return parseModelList(readyProvider.value.models).length > 0;
  });
  const hasReadyModel = computed(() => readyModel.value.length > 0);
  const hasEnabledButNotConfiguredProvider = computed(
    () => providers.value.some(provider => provider.enabled) && !hasConfiguredProvider.value
  );
  const isReadyToChat = computed(() => hasConfiguredProvider.value && hasReadyModel.value);

  const awakeningState = computed<'sleeping' | 'warming' | 'awake'>(() => {
    if (isReadyToChat.value) return 'awake';
    if (hasConfiguredProvider.value || hasEnabledButNotConfiguredProvider.value) return 'warming';
    return 'sleeping';
  });

  const awakeningLabel = computed(() => {
    if (isLoadingSetup.value) return t('chat.welcome.status.checking');
    return t(`chat.welcome.status.${awakeningState.value}`);
  });

  const awakeningHeadline = computed(() => {
    if (isReadyToChat.value) return t('chat.welcome.headline.awake');
    return t('chat.welcome.headline.setup');
  });

  const awakeningBody = computed(() => {
    if (isReadyToChat.value) return t('chat.welcome.body.awake');
    if (hasEnabledButNotConfiguredProvider.value) return t('chat.welcome.body.finishProvider');
    return t('chat.welcome.body.setup');
  });

  const readyContextLabel = computed(() => {
    if (!isReadyToChat.value || !readyProviderName.value || !readyModel.value) return '';
    return `${readyProviderName.value} · ${readyModel.value}`;
  });

  const primaryActionLabel = computed(() => {
    if (!hasConfiguredProvider.value) return t('chat.welcome.primary.connectProvider');
    if (!hasReadyModel.value) {
      return selectedProviderHasModels.value
        ? t('chat.welcome.primary.pickModel')
        : t('chat.welcome.primary.finishProvider');
    }
    return t('chat.welcome.primary.draftHello');
  });

  const onboardingHint = computed(() => {
    if (isLoadingSetup.value) return t('chat.welcome.hint.loading');
    if (!hasConfiguredProvider.value) {
      return hasEnabledButNotConfiguredProvider.value
        ? t('chat.welcome.hint.finishProvider')
        : t('chat.welcome.hint.connectProvider');
    }

    if (!hasReadyModel.value) {
      return selectedProviderHasModels.value
        ? t('chat.welcome.hint.modelReady')
        : t('chat.welcome.hint.addModel');
    }

    return t('chat.welcome.hint.ready');
  });

  const successMilestone = computed<WelcomeMilestone | null>(() => {
    if (!hasConfiguredProvider.value) return null;

    if (!hasReadyModel.value) {
      return {
        title: t('chat.welcome.milestone.provider.title'),
        body: t('chat.welcome.milestone.provider.body', {
          provider: readyProviderName.value || configuredProviders.value[0]?.name || '',
        }),
      };
    }

    return {
      title: t('chat.welcome.milestone.model.title'),
      body: t('chat.welcome.milestone.model.body', {
        provider: readyProviderName.value,
        model: readyModel.value,
      }),
    };
  });

  const successMilestoneStageKey = computed<string | null>(() => {
    if (!hasConfiguredProvider.value) return null;
    return hasReadyModel.value ? 'model' : 'provider';
  });

  const visibleSuccessMilestone = computed<WelcomeMilestone | null>(() => {
    if (!successMilestone.value) return null;
    if (
      successMilestoneStageKey.value &&
      dismissedMilestoneStageKey.value === successMilestoneStageKey.value
    ) {
      return null;
    }
    return successMilestone.value;
  });

  const contextSources = computed<WelcomeContextSource[]>(() => {
    if (!isReadyToChat.value) return [];

    return [
      {
        title: t('chat.welcome.contextSources.project.title'),
        body: t('chat.welcome.contextSources.project.body'),
      },
      {
        title: t('chat.welcome.contextSources.task.title'),
        body: t('chat.welcome.contextSources.task.body'),
      },
      {
        title: t('chat.welcome.contextSources.text.title'),
        body: t('chat.welcome.contextSources.text.body'),
      },
    ];
  });

  const starterPrompts = computed(() => [
    t('chat.welcome.prompt.intro'),
    t('chat.welcome.prompt.plan'),
    t('chat.welcome.prompt.learn'),
  ]);

  const onboardingSteps = computed<OnboardingStep[]>(() => {
    const providerStatus: OnboardingStep['status'] = hasConfiguredProvider.value
      ? 'done'
      : isLoadingSetup.value || hasEnabledButNotConfiguredProvider.value
        ? 'active'
        : 'pending';

    const modelStatus: OnboardingStep['status'] = hasReadyModel.value
      ? 'done'
      : hasConfiguredProvider.value
        ? 'active'
        : 'pending';

    const messageStatus: OnboardingStep['status'] = isReadyToChat.value ? 'active' : 'pending';

    return [
      {
        key: 'provider',
        title: t('chat.welcome.step.provider.title'),
        detail: isLoadingSetup.value
          ? t('chat.welcome.step.provider.checking')
          : hasConfiguredProvider.value
            ? t('chat.welcome.step.provider.ready', { provider: readyProviderName.value })
            : hasEnabledButNotConfiguredProvider.value
              ? t('chat.welcome.step.provider.finish')
              : t('chat.welcome.step.provider.pending'),
        status: providerStatus,
      },
      {
        key: 'model',
        title: t('chat.welcome.step.model.title'),
        detail: !hasConfiguredProvider.value
          ? t('chat.welcome.step.model.pending')
          : hasReadyModel.value
            ? t('chat.welcome.step.model.ready', { model: readyModel.value })
            : selectedProviderHasModels.value
              ? t('chat.welcome.step.model.choose')
              : t('chat.welcome.step.model.add'),
        status: modelStatus,
      },
      {
        key: 'message',
        title: t('chat.welcome.step.message.title'),
        detail: isReadyToChat.value
          ? t('chat.welcome.step.message.ready')
          : t('chat.welcome.step.message.pending'),
        status: messageStatus,
      },
    ];
  });

  const openProviderSettings = () => {
    openSettingsWindow?.('provider');
  };

  const openSettingsOverview = () => {
    openSettingsWindow?.();
  };

  const focusBlankDraft = () => {
    params.onComposeStarter('');
  };

  const handlePrimaryAction = () => {
    if (!isReadyToChat.value) {
      openProviderSettings();
      return;
    }

    params.onComposeStarter(starterPrompts.value[0]);
  };

  const dismissSuccessMilestone = () => {
    if (!successMilestoneStageKey.value) return;
    dismissedMilestoneStageKey.value = successMilestoneStageKey.value;
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
    awakeningBody,
    awakeningHeadline,
    awakeningLabel,
    awakeningState,
    contextSources,
    dismissSuccessMilestone,
    focusBlankDraft,
    handlePrimaryAction,
    isReadyToChat,
    onboardingHint,
    onboardingSteps,
    openSettingsOverview,
    primaryActionLabel,
    readyContextLabel,
    starterPrompts,
    visibleSuccessMilestone,
  };
};
