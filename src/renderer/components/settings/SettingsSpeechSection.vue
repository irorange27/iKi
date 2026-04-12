<template>
  <section class="config-section">
    <div class="config-group">
      <h3>{{ t('settings.speech.inputTitle') }}</h3>
      <label class="checkbox-label">
        <input
          type="checkbox"
          :checked="config.speech.enabled"
          @change="updateSpeech('enabled', ($event.target as HTMLInputElement).checked)"
        />
        {{ t('settings.speech.enable') }}
      </label>
      <p class="group-description">{{ t('settings.speech.inputDescription') }}</p>
    </div>

    <div v-if="config.speech.enabled" class="config-group">
      <h3>{{ t('settings.speech.providerTitle') }}</h3>
      <label class="input-label">
        <span>{{ t('common.provider') }}</span>
        <SettingsSelect
          :model-value="config.speech.providerType"
          :options="speechProviderOptions"
          :aria-label="t('settings.speech.providerAria')"
          @update:model-value="updateSpeechProviderSelection"
        />
      </label>

      <template v-if="config.speech.providerType === 'openai'">
        <label class="input-label">
          <span>{{ t('settings.speech.apiKey') }}</span>
          <input
            type="password"
            :value="config.speech.apiKey"
            :placeholder="t('settings.speech.apiKeyPlaceholder')"
            @input="updateSpeech('apiKey', ($event.target as HTMLInputElement).value)"
          />
        </label>
        <label class="input-label">
          <span>{{ t('settings.speech.baseUrlOptional') }}</span>
          <input
            type="text"
            :value="config.speech.baseUrl"
            :placeholder="t('settings.speech.baseUrlPlaceholder')"
            @input="updateSpeech('baseUrl', ($event.target as HTMLInputElement).value)"
          />
        </label>
        <label class="input-label">
          <span>{{ t('settings.speech.model') }}</span>
          <input
            type="text"
            :value="config.speech.model"
            :placeholder="t('settings.speech.modelPlaceholder')"
            @input="updateSpeech('model', ($event.target as HTMLInputElement).value)"
          />
        </label>
      </template>

      <template v-else-if="config.speech.providerType === 'whisper-node'">
        <label class="input-label">
          <span>{{ t('settings.speech.modelName') }}</span>
          <input
            type="text"
            :value="config.speech.model"
            :placeholder="t('settings.speech.modelNamePlaceholder')"
            @input="updateSpeech('model', ($event.target as HTMLInputElement).value)"
          />
        </label>
        <p v-if="isCustomWhisperModelName" class="group-description warning-text">
          {{ t('settings.speech.customModelWarning') }}
        </p>
        <label class="input-label">
          <span>{{ t('settings.speech.modelPathOptional') }}</span>
          <input
            type="text"
            :value="config.speech.modelPath"
            :placeholder="t('settings.speech.modelPathPlaceholder')"
            @input="updateSpeech('modelPath', ($event.target as HTMLInputElement).value)"
          />
        </label>
        <label class="input-label">
          <span>{{ t('settings.speech.downloadBaseUrlOptional') }}</span>
          <input
            type="text"
            :value="config.speech.downloadBaseUrl"
            :placeholder="t('settings.speech.downloadBaseUrlPlaceholder')"
            @input="updateSpeech('downloadBaseUrl', ($event.target as HTMLInputElement).value)"
          />
        </label>
        <p class="group-description">{{ t('settings.speech.downloadBaseUrlHelp') }}</p>
        <p v-if="hasCustomWhisperModelPath" class="group-description">
          {{ t('settings.speech.customModelPathNotice') }}
        </p>
        <div class="speech-models-card">
          <div class="speech-models-header">
            <span>{{ t('settings.speech.downloadModels') }}</span>
            <button
              class="secondary-btn speech-btn"
              @click="loadWhisperModels"
              :disabled="whisperModelsLoading"
            >
              <RefreshCw :size="14" :class="{ 'animate-spin': whisperModelsLoading }" />
              {{
                whisperModelsLoading
                  ? t('settings.speech.loadingModels')
                  : t('settings.speech.refreshModels')
              }}
            </button>
          </div>
          <div v-if="whisperModelsLoading" class="speech-models-empty">
            {{ t('settings.speech.loadingModelsLong') }}
          </div>
          <div v-else-if="whisperModelsError" class="speech-models-error">
            {{ whisperModelsError }}
          </div>
          <div v-else class="speech-models-list">
            <div v-for="model in whisperModels" :key="model.name" class="speech-model-row">
              <div class="speech-model-row-main">
                <div class="speech-model-meta">
                  <div class="speech-model-name">{{ model.name }}</div>
                  <div class="speech-model-stats">
                    {{ model.sizeMB }} MB · ~{{ model.ramGB }} GB RAM
                  </div>
                  <div
                    v-if="isWhisperModelSelected(model) && model.downloaded"
                    class="speech-model-badge"
                  >
                    {{ t('common.selected') }}
                  </div>
                  <div v-if="model.status === 'invalid'" class="speech-model-badge is-danger">
                    {{ t('settings.speech.badge.corrupted') }}
                  </div>
                  <div v-if="whisperModelDownloadErrors[model.name]" class="speech-model-error">
                    {{ whisperModelDownloadErrors[model.name] }}
                  </div>
                  <div
                    v-else-if="model.status === 'invalid' && model.error"
                    class="speech-model-error"
                  >
                    {{ model.error }}
                  </div>
                </div>
                <div class="speech-model-actions">
                  <button
                    class="speech-btn"
                    :class="{
                      'is-primary': !model.downloaded && getWhisperModelStage(model) === 'idle',
                      'is-busy': isWhisperStageBusy(getWhisperModelStage(model)),
                      'is-success': getWhisperModelStage(model) === 'done',
                      'is-danger':
                        getWhisperModelStage(model) === 'error' || model.status === 'invalid',
                    }"
                    :disabled="
                      (isWhisperModelSelected(model) && getWhisperModelStage(model) === 'done') ||
                      isWhisperStageBusy(getWhisperModelStage(model))
                    "
                    @click="handleWhisperModelAction(model)"
                  >
                    <span
                      v-if="isWhisperStageBusy(getWhisperModelStage(model))"
                      class="speech-btn-spinner"
                    />
                    {{ getWhisperActionLabel(model) }}
                  </button>
                </div>
              </div>
              <div
                v-if="isWhisperStageBusy(getWhisperModelStage(model))"
                class="speech-model-progress"
              >
                <div class="speech-model-progress-track">
                  <div
                    class="speech-model-progress-bar"
                    :class="getWhisperProgressClass(model, getWhisperModelStage(model))"
                    :style="getWhisperProgressStyle(model)"
                  />
                </div>
                <span class="speech-model-progress-text">
                  {{ getWhisperProgressText(model, getWhisperModelStage(model)) }}
                </span>
              </div>
            </div>
          </div>
        </div>
        <p class="group-description">
          {{ t('settings.speech.downloadHint') }}
        </p>
      </template>

      <div class="speech-status" :class="speechStatusToneClass">
        <span class="speech-status-dot" />
        <div class="speech-status-body">
          <div class="speech-status-title">{{ speechStatusTitle }}</div>
          <div class="speech-status-detail">{{ speechStatusDetail }}</div>
        </div>
      </div>

      <label class="input-label">
        <span>{{ t('settings.speech.recognitionLanguage') }}</span>
        <SettingsSelect
          :model-value="speechLanguageValue"
          :options="speechLanguageOptions"
          :aria-label="t('settings.speech.recognitionLanguageAria')"
          @update:model-value="updateSpeechLanguageSelection"
        />
      </label>

      <label v-if="config.speech.providerType === 'openai'" class="input-label">
        <span>{{ t('settings.speech.promptOptional') }}</span>
        <textarea
          rows="3"
          :value="config.speech.prompt"
          :placeholder="t('settings.speech.promptPlaceholder')"
          @input="updateSpeech('prompt', ($event.target as HTMLTextAreaElement).value)"
        />
      </label>
    </div>

    <div class="config-actions">
      <button class="reset-btn" type="button" @click="emit('reset')">
        {{ t('settings.speech.reset') }}
      </button>
    </div>
  </section>
</template>

<script setup lang="ts">
import { toRefs } from 'vue';
import { RefreshCw } from 'lucide-vue-next';

import SettingsSelect from './SettingsSelect.vue';
import { useI18n } from '../../i18n';
import { useSettingsSpeechSection } from '../../composables/useSettingsSpeechSection';

const emit = defineEmits<{
  (event: 'config-change'): void;
  (event: 'reset'): void;
}>();

const props = defineProps<{
  active: boolean;
}>();

const { t } = useI18n();
const { active } = toRefs(props);

const {
  config,
  getWhisperActionLabel,
  getWhisperModelStage,
  getWhisperProgressClass,
  getWhisperProgressStyle,
  getWhisperProgressText,
  handleWhisperModelAction,
  hasCustomWhisperModelPath,
  isCustomWhisperModelName,
  isWhisperModelSelected,
  isWhisperStageBusy,
  loadWhisperModels,
  speechLanguageOptions,
  speechLanguageValue,
  speechProviderOptions,
  speechStatusDetail,
  speechStatusTitle,
  speechStatusToneClass,
  updateSpeech,
  updateSpeechLanguageSelection,
  updateSpeechProviderSelection,
  whisperModelDownloadErrors,
  whisperModels,
  whisperModelsError,
  whisperModelsLoading,
} = useSettingsSpeechSection({
  active,
  onConfigChange: () => emit('config-change'),
});
</script>

<style scoped src="./settings_shared.css"></style>
<style scoped src="./settings_speech_section.css"></style>
