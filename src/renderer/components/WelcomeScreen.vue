<template>
  <section class="welcome-shell">
    <div class="welcome-copy">
      <div class="welcome-kicker ui-text-secondary">{{ t('chat.welcome.kicker') }}</div>

      <div class="welcome-title-row">
        <h1 class="welcome-brand ui-text-primary">iKi</h1>
        <span class="welcome-state-pill" :class="`welcome-state-pill-${awakeningState}`">
          {{ awakeningLabel }}
        </span>
      </div>

      <p class="welcome-headline ui-text-primary">
        {{ awakeningHeadline }}
      </p>

      <p class="welcome-body ui-text-secondary">
        {{ awakeningBody }}
      </p>

      <div
        v-if="visibleSuccessMilestone"
        class="welcome-milestone"
        role="status"
        aria-live="polite"
      >
        <div class="welcome-message-topline">
          <span class="welcome-milestone-label">{{ t('chat.welcome.milestone.label') }}</span>
          <button
            class="welcome-message-dismiss"
            type="button"
            :aria-label="t('common.close')"
            @click="dismissSuccessMilestone"
          >
            <X :size="14" />
          </button>
        </div>
        <div class="welcome-milestone-copy">
          <span class="welcome-milestone-title ui-text-primary">{{
            visibleSuccessMilestone.title
          }}</span>
          <span class="welcome-milestone-body ui-text-secondary">{{
            visibleSuccessMilestone.body
          }}</span>
        </div>
      </div>

      <div v-if="readyContextLabel" class="welcome-ready-strip">
        <span class="welcome-ready-label ui-text-muted">{{ t('chat.welcome.contextLabel') }}</span>
        <span class="welcome-ready-value ui-text-primary">{{ readyContextLabel }}</span>
      </div>

      <div class="welcome-actions">
        <button class="welcome-primary-btn" type="button" @click="handlePrimaryAction">
          {{ primaryActionLabel }}
        </button>
        <button class="welcome-secondary-btn" type="button" @click="openSettingsOverview">
          {{ t('chat.welcome.settings') }}
        </button>
      </div>

      <p class="welcome-hint ui-text-muted">
        {{ onboardingHint }}
      </p>

      <div v-if="contextSources.length > 0" class="welcome-context">
        <div class="welcome-context-label ui-text-muted">
          {{ t('chat.welcome.contextSources.label') }}
        </div>
        <div class="welcome-context-grid" role="list">
          <article
            v-for="source in contextSources"
            :key="source.title"
            class="welcome-context-card"
            role="listitem"
          >
            <span class="welcome-context-title ui-text-primary">{{ source.title }}</span>
            <span class="welcome-context-body ui-text-secondary">{{ source.body }}</span>
          </article>
        </div>
      </div>

      <div v-if="isReadyToChat" class="welcome-prompts" role="list">
        <button
          v-for="prompt in starterPrompts"
          :key="prompt"
          class="welcome-prompt-btn"
          type="button"
          role="listitem"
          @click="emit('compose-starter', prompt)"
        >
          {{ prompt }}
        </button>
        <button class="welcome-prompt-btn welcome-prompt-btn-subtle" type="button" @click="focusBlankDraft">
          {{ t('chat.welcome.prompt.blank') }}
        </button>
      </div>
    </div>

    <div class="welcome-stage">
      <div class="welcome-figure" aria-hidden="true">
        <div class="welcome-core">
          <div class="welcome-core-halo"></div>
          <div class="welcome-core-ring welcome-core-ring-outer"></div>
          <div class="welcome-core-ring welcome-core-ring-inner"></div>
          <div class="welcome-core-spark welcome-core-spark-a"></div>
          <div class="welcome-core-spark welcome-core-spark-b"></div>
          <div class="welcome-core-center"></div>
        </div>
      </div>

      <div class="welcome-steps-shell">
        <div class="welcome-steps-label ui-text-muted">{{ t('chat.welcome.progressLabel') }}</div>
        <ol class="welcome-steps">
          <li v-for="step in onboardingSteps" :key="step.key" class="welcome-step">
            <span class="welcome-step-marker" :class="`welcome-step-marker-${step.status}`"></span>
            <div class="welcome-step-copy">
              <span class="welcome-step-title ui-text-primary">{{ step.title }}</span>
              <span class="welcome-step-detail ui-text-secondary">{{ step.detail }}</span>
            </div>
          </li>
        </ol>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { X } from 'lucide-vue-next';

import type { Provider } from '../../shared/types/provider';
import { parseModelList } from '../../shared/utils/provider_models';
import { resolveProviderSelection } from '../composables/useChatProviderSelection';
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

const props = defineProps<{
  activeModel?: string;
  activeProviderId?: string | null;
}>();

const emit = defineEmits<{
  (event: 'compose-starter', text: string): void;
}>();

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
    configuredProviders.value.find(provider => provider.id === props.activeProviderId) ?? null
);

const resolvedSelection = computed(() =>
  resolveProviderSelection({
    providers: configuredProviders.value,
    currentProvider: currentConfiguredProvider.value,
    currentModel: props.activeModel ?? '',
    preferredModel: props.activeModel ?? '',
    preferredProviderId: props.activeProviderId ?? '',
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
  emit('compose-starter', '');
};

const handlePrimaryAction = () => {
  if (!isReadyToChat.value) {
    openProviderSettings();
    return;
  }

  emit('compose-starter', starterPrompts.value[0]);
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
</script>

<style scoped>
.welcome-shell {
  position: relative;
  display: grid;
  width: min(100%, 980px);
  grid-template-columns: minmax(0, 1.15fr) minmax(320px, 0.85fr);
  gap: clamp(28px, 6vw, 64px);
  align-items: center;
  padding: clamp(16px, 3vw, 28px);
}

.welcome-copy {
  position: relative;
  z-index: 1;
}

.welcome-kicker {
  font-size: 11px;
  font-weight: 650;
  letter-spacing: 0.18em;
  text-transform: uppercase;
}

.welcome-title-row {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-top: 12px;
}

.welcome-brand {
  margin: 0;
  font-family: Georgia, 'Times New Roman', serif;
  font-size: clamp(56px, 8vw, 88px);
  font-weight: 500;
  line-height: 0.92;
  letter-spacing: -0.04em;
}

.welcome-state-pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 30px;
  border-radius: 999px;
  padding: 0 12px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  border: 1px solid var(--border-color);
  background: var(--bg-tertiary);
}

.welcome-state-pill-sleeping {
  color: var(--text-secondary);
}

.welcome-state-pill-warming {
  color: var(--warning-color);
  border-color: color-mix(in srgb, var(--warning-color) 34%, var(--border-color));
  background: color-mix(in srgb, var(--warning-color) 10%, var(--bg-tertiary));
}

.welcome-state-pill-awake {
  color: var(--success-color);
  border-color: color-mix(in srgb, var(--success-color) 36%, var(--border-color));
  background: color-mix(in srgb, var(--success-color) 10%, var(--bg-tertiary));
}

.welcome-headline {
  max-width: 11ch;
  margin: 18px 0 0;
  font-size: clamp(28px, 4vw, 42px);
  line-height: 1.04;
  letter-spacing: -0.04em;
}

.welcome-body {
  max-width: 44ch;
  margin: 16px 0 0;
  font-size: 15px;
  line-height: 1.65;
}

.welcome-ready-strip {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-top: 18px;
  border-bottom: 1px solid color-mix(in srgb, var(--accent-color) 30%, transparent);
  padding-bottom: 8px;
}

.welcome-milestone {
  display: grid;
  gap: 8px;
  max-width: 48ch;
  margin-top: 20px;
  padding: 16px 18px;
  border-radius: 20px;
  border: 1px solid color-mix(in srgb, var(--success-color) 34%, var(--border-color));
  background:
    linear-gradient(
      135deg,
      color-mix(in srgb, var(--success-color) 12%, var(--bg-secondary)),
      color-mix(in srgb, var(--accent-color) 6%, var(--bg-primary))
    );
  box-shadow: 0 16px 34px rgba(var(--success-rgb), 0.08);
}

.welcome-message-topline {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.welcome-milestone-label {
  display: inline-flex;
  width: fit-content;
  min-height: 24px;
  align-items: center;
  border-radius: 999px;
  padding: 0 10px;
  background: color-mix(in srgb, var(--success-color) 18%, var(--bg-primary));
  color: color-mix(in srgb, var(--success-color) 84%, white 16%);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.welcome-message-dismiss {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--border-color) 88%, transparent);
  background: color-mix(in srgb, var(--bg-primary) 72%, transparent);
  color: var(--text-secondary);
  cursor: pointer;
  transition:
    border-color 0.18s ease,
    background-color 0.18s ease,
    color 0.18s ease,
    transform 0.18s ease;
}

.welcome-message-dismiss:hover {
  transform: translateY(-1px);
  border-color: color-mix(in srgb, var(--accent-color) 28%, var(--border-color));
  background: var(--bg-hover);
  color: var(--text-primary);
}

.welcome-message-dismiss:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--accent-color) 62%, white 38%);
  outline-offset: 2px;
}

.welcome-milestone-copy {
  display: grid;
  gap: 4px;
}

.welcome-milestone-title {
  font-size: 16px;
  font-weight: 650;
  line-height: 1.35;
}

.welcome-milestone-body {
  font-size: 13px;
  line-height: 1.6;
}

.welcome-ready-label {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.welcome-ready-value {
  font-size: 14px;
  font-weight: 600;
}

.welcome-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 24px;
}

.welcome-primary-btn,
.welcome-secondary-btn,
.welcome-prompt-btn {
  border: 1px solid transparent;
  cursor: pointer;
  transition:
    transform 0.18s ease,
    border-color 0.18s ease,
    background-color 0.18s ease,
    color 0.18s ease,
    box-shadow 0.18s ease;
}

.welcome-primary-btn {
  min-height: 46px;
  border-radius: 999px;
  padding: 0 18px;
  background:
    linear-gradient(
      135deg,
      color-mix(in srgb, var(--accent-color) 92%, white 8%),
      color-mix(in srgb, var(--accent-color) 70%, var(--bg-primary))
    );
  color: var(--accent-contrast);
  box-shadow:
    0 16px 28px rgba(var(--accent-rgb), 0.22),
    inset 0 1px 0 rgba(255, 255, 255, 0.18);
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 0.01em;
}

.welcome-primary-btn:hover {
  transform: translateY(-1px);
  box-shadow:
    0 22px 38px rgba(var(--accent-rgb), 0.28),
    inset 0 1px 0 rgba(255, 255, 255, 0.22);
}

.welcome-primary-btn:focus-visible,
.welcome-secondary-btn:focus-visible,
.welcome-prompt-btn:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--accent-color) 62%, white 38%);
  outline-offset: 3px;
}

.welcome-secondary-btn {
  min-height: 46px;
  border-radius: 999px;
  padding: 0 18px;
  border-color: var(--border-color);
  background: color-mix(in srgb, var(--bg-secondary) 90%, transparent);
  color: var(--text-secondary);
  font-size: 14px;
  font-weight: 600;
}

.welcome-secondary-btn:hover,
.welcome-prompt-btn:hover {
  transform: translateY(-1px);
  border-color: color-mix(in srgb, var(--accent-color) 26%, var(--border-color));
  background: var(--bg-hover);
  color: var(--text-primary);
}

.welcome-hint {
  max-width: 48ch;
  margin: 14px 0 0;
  font-size: 13px;
  line-height: 1.6;
}

.welcome-context {
  display: grid;
  gap: 10px;
  margin-top: 18px;
  max-width: 760px;
}

.welcome-context-label {
  font-size: 11px;
  font-weight: 650;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.welcome-context-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 10px;
}

.welcome-context-card {
  display: grid;
  gap: 6px;
  min-width: 0;
  padding: 12px 14px;
  border-radius: 16px;
  border: 1px solid color-mix(in srgb, var(--border-color) 88%, transparent);
  background: color-mix(in srgb, var(--bg-secondary) 88%, transparent);
}

.welcome-context-title {
  font-size: 13px;
  font-weight: 620;
}

.welcome-context-body {
  font-size: 12px;
  line-height: 1.55;
}

.welcome-prompts {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 10px;
  margin-top: 18px;
}

.welcome-prompt-btn {
  border-radius: 18px;
  padding: 11px 14px;
  border-color: color-mix(in srgb, var(--accent-color) 18%, var(--border-color));
  background: color-mix(in srgb, var(--bg-secondary) 90%, transparent);
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 1.45;
  text-align: left;
}

.welcome-prompt-btn-subtle {
  border-style: dashed;
}

.welcome-stage {
  position: relative;
  min-width: 0;
}

.welcome-figure {
  position: relative;
  display: flex;
  justify-content: center;
  padding: 18px 0 24px;
}

.welcome-core {
  position: relative;
  width: min(100%, 320px);
  aspect-ratio: 1 / 1;
  display: grid;
  place-items: center;
}

.welcome-core-halo {
  position: absolute;
  inset: 18%;
  border-radius: 999px;
  background:
    radial-gradient(circle, rgba(var(--accent-rgb), 0.2) 0%, rgba(var(--accent-rgb), 0) 68%);
  filter: blur(24px);
}

.welcome-core-ring {
  position: absolute;
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--accent-color) 22%, transparent);
  animation: welcomeRingPulse 4.4s ease-in-out infinite;
}

.welcome-core-ring-outer {
  inset: 6%;
}

.welcome-core-ring-inner {
  inset: 20%;
  animation-delay: -1.1s;
}

.welcome-core-center {
  position: absolute;
  inset: 34%;
  border-radius: 999px;
  background:
    radial-gradient(circle at 30% 30%, rgba(255, 255, 255, 0.2), transparent 38%),
    linear-gradient(
      145deg,
      color-mix(in srgb, var(--accent-color) 82%, white 18%),
      color-mix(in srgb, var(--accent-color) 54%, var(--bg-secondary))
    );
  box-shadow:
    0 20px 48px rgba(var(--accent-rgb), 0.28),
    inset 0 1px 0 rgba(255, 255, 255, 0.2);
  animation: welcomeCoreBreath 3.4s ease-in-out infinite;
}

.welcome-core-spark {
  position: absolute;
  width: 10px;
  height: 10px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--accent-color) 70%, white 30%);
  box-shadow: 0 0 18px rgba(var(--accent-rgb), 0.35);
}

.welcome-core-spark-a {
  top: 22%;
  right: 22%;
  animation: welcomeSparkFloat 5.2s ease-in-out infinite;
}

.welcome-core-spark-b {
  bottom: 24%;
  left: 18%;
  animation: welcomeSparkFloat 4.6s ease-in-out infinite reverse;
}

.welcome-steps-shell {
  border-top: 1px solid color-mix(in srgb, var(--border-color) 70%, transparent);
  padding-top: 18px;
}

.welcome-steps-label {
  font-size: 11px;
  font-weight: 650;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.welcome-steps {
  display: grid;
  gap: 16px;
  margin: 14px 0 0;
  padding: 0;
  list-style: none;
}

.welcome-step {
  display: grid;
  grid-template-columns: 16px minmax(0, 1fr);
  gap: 12px;
  align-items: start;
}

.welcome-step-marker {
  position: relative;
  width: 12px;
  height: 12px;
  margin-top: 4px;
  border-radius: 999px;
  border: 1px solid var(--border-color);
  background: transparent;
}

.welcome-step-marker::after {
  content: '';
  position: absolute;
  inset: -6px;
  border-radius: 999px;
  opacity: 0;
  transform: scale(0.8);
  transition:
    opacity 0.18s ease,
    transform 0.18s ease;
}

.welcome-step-marker-done {
  border-color: color-mix(in srgb, var(--success-color) 60%, var(--border-color));
  background: var(--success-color);
}

.welcome-step-marker-active {
  border-color: color-mix(in srgb, var(--accent-color) 56%, var(--border-color));
  background: color-mix(in srgb, var(--accent-color) 14%, transparent);
}

.welcome-step-marker-active::after {
  opacity: 1;
  transform: scale(1);
  background: rgba(var(--accent-rgb), 0.12);
}

.welcome-step-copy {
  display: grid;
  gap: 4px;
}

.welcome-step-title {
  font-size: 14px;
  font-weight: 620;
}

.welcome-step-detail {
  font-size: 13px;
  line-height: 1.55;
}

@keyframes welcomeRingPulse {
  0%,
  100% {
    opacity: 0.4;
    transform: scale(0.98);
  }

  50% {
    opacity: 0.85;
    transform: scale(1.02);
  }
}

@keyframes welcomeCoreBreath {
  0%,
  100% {
    transform: scale(0.98);
  }

  50% {
    transform: scale(1.03);
  }
}

@keyframes welcomeSparkFloat {
  0%,
  100% {
    transform: translate3d(0, 0, 0);
    opacity: 0.45;
  }

  50% {
    transform: translate3d(4px, -8px, 0);
    opacity: 1;
  }
}

@media (max-width: 1120px) {
  .welcome-shell {
    grid-template-columns: 1fr;
    gap: 24px;
    padding: 12px 0 0;
  }

  .welcome-figure {
    justify-content: flex-start;
    padding: 0 0 14px;
  }

  .welcome-core {
    width: min(100%, 220px);
  }

  .welcome-steps {
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 14px 16px;
  }

  .welcome-step {
    gap: 10px;
  }

  .welcome-step-detail {
    font-size: 12px;
  }
}

@media (max-width: 640px) {
  .welcome-brand {
    font-size: 52px;
  }

  .welcome-headline {
    max-width: none;
    font-size: 28px;
  }

  .welcome-context-grid,
  .welcome-prompts {
    grid-template-columns: 1fr;
  }

  .welcome-actions {
    flex-direction: column;
  }

  .welcome-primary-btn,
  .welcome-secondary-btn {
    width: 100%;
    justify-content: center;
  }
}

@media (max-height: 760px) {
  .welcome-shell {
    gap: 18px;
    padding-top: 8px;
  }

  .welcome-brand {
    font-size: clamp(46px, 7vw, 64px);
  }

  .welcome-headline {
    max-width: none;
    font-size: clamp(24px, 3.6vw, 34px);
  }

  .welcome-body {
    font-size: 14px;
    line-height: 1.55;
  }

  .welcome-figure {
    display: none;
  }

  .welcome-steps-shell {
    border-top: none;
    padding-top: 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .welcome-primary-btn,
  .welcome-secondary-btn,
  .welcome-prompt-btn,
  .welcome-message-dismiss,
  .welcome-step-marker::after {
    transition: none;
  }

  .welcome-core-ring,
  .welcome-core-center,
  .welcome-core-spark-a,
  .welcome-core-spark-b {
    animation: none;
  }

  .welcome-primary-btn:hover,
  .welcome-secondary-btn:hover,
  .welcome-prompt-btn:hover,
  .welcome-message-dismiss:hover {
    transform: none;
  }
}
</style>
