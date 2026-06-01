<template>
  <section class="welcome-shell">
    <div class="welcome-copy">
      <div class="welcome-title-row">
        <h1 class="welcome-brand ui-text-primary">iKi</h1>
      </div>

      <div v-if="readyContextLabel" class="welcome-ready-strip">
        <span class="welcome-ready-value ui-text-primary">{{ readyContextLabel }}</span>
      </div>

      <div v-if="!isReadyToChat" class="welcome-actions">
        <button class="welcome-secondary-btn" type="button" @click="openSettingsOverview">
          {{ t('chat.welcome.settings') }}
        </button>
      </div>

      <div v-if="isReadyToChat" class="welcome-prompts">
        <button
          v-for="prompt in starterPrompts"
          :key="prompt"
          class="welcome-prompt-btn"
          type="button"
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
    </div>
  </section>
</template>

<script setup lang="ts">
import { toRefs } from 'vue';
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
  focusBlankDraft,
  isReadyToChat,
  openSettingsOverview,
  readyContextLabel,
  starterPrompts,
} = useWelcomeScreenState({
  activeModel,
  activeProviderId,
  onComposeStarter: text => emit('compose-starter', text),
});
</script>

<style scoped src="./welcome_screen.css"></style>
