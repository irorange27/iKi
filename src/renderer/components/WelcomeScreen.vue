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
        <button
          class="welcome-secondary-btn welcome-secondary-btn-settings"
          type="button"
          @click="openSettingsOverview"
        >
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
        <button
          class="welcome-prompt-btn welcome-prompt-btn-subtle"
          type="button"
          @click="focusBlankDraft"
        >
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
import { toRefs } from 'vue';
import { X } from 'lucide-vue-next';

import { useWelcomeScreenState } from '../composables/useWelcomeScreenState';
import { useI18n } from '../i18n';

const props = defineProps<{
  activeModel?: string;
  activeProviderId?: string | null;
}>();

const emit = defineEmits<{
  (event: 'compose-starter', text: string): void;
}>();

const { t } = useI18n();
const { activeModel, activeProviderId } = toRefs(props);

const {
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
} = useWelcomeScreenState({
  activeModel,
  activeProviderId,
  onComposeStarter: text => emit('compose-starter', text),
});
</script>

<style scoped src="./welcome_screen.css"></style>
