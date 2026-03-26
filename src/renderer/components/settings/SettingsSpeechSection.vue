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
              {{ whisperModelsLoading ? t('settings.speech.loadingModels') : t('settings.speech.refreshModels') }}
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
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { RefreshCw } from 'lucide-vue-next';

import SettingsSelect from './SettingsSelect.vue';
import { useI18n } from '../../i18n';
import { useConfigStore } from '../../store/config';
import type { AppConfig } from '../../../shared/types/config';
import type {
  SpeechStatus,
  WhisperNodeDownloadProgress,
  WhisperNodeModelInfo,
} from '../../../shared/types/speech';
import { getErrorMessage } from '../../../shared/utils/errors';

const emit = defineEmits<{
  (event: 'config-change'): void;
  (event: 'reset'): void;
}>();

const props = defineProps<{
  active: boolean;
}>();
const electronAPI = window.electronAPI as NonNullable<typeof window.electronAPI>;
const { t } = useI18n();

type WhisperDownloadStage = 'idle' | 'downloading' | 'compiling' | 'done' | 'error';
type WhisperDownloadProgressState = {
  progress?: number;
  downloadedBytes?: number;
  totalBytes?: number;
};
type SpeechLanguageOption = { value: string; label: string };

const configStore = useConfigStore();
const { config } = storeToRefs(configStore);

const speechStatus = ref<SpeechStatus | null>(null);
const speechStatusLoading = ref(false);
let speechStatusTimer: number | null = null;
const whisperModels = ref<WhisperNodeModelInfo[]>([]);
const whisperModelsLoading = ref(false);
const whisperModelsError = ref('');
const whisperModelStages = ref<Record<string, WhisperDownloadStage>>({});
const whisperModelDownloadErrors = ref<Record<string, string>>({});
const whisperModelProgress = ref<Record<string, WhisperDownloadProgressState>>({});

const speechProviderOptions = computed(() => [
  { value: 'openai', label: t('settings.speech.provider.openai') },
  { value: 'whisper-node', label: t('settings.speech.provider.whisperNode') },
]);

const selectedWhisperModel = computed(() => {
  if (config.value.speech.providerType !== 'whisper-node') return '';
  if (config.value.speech.modelPath && config.value.speech.modelPath.trim()) return '';
  return config.value.speech.model?.trim() || '';
});

const isCustomWhisperModelName = computed(() => {
  if (config.value.speech.providerType !== 'whisper-node') return false;
  const modelName = config.value.speech.model?.trim();
  if (!modelName) return false;
  return !whisperModels.value.some(model => model.name === modelName);
});

const hasCustomWhisperModelPath = computed(
  () =>
    config.value.speech.providerType === 'whisper-node' &&
    !!config.value.speech.modelPath &&
    config.value.speech.modelPath.trim().length > 0
);

const speechStatusTitle = computed(() => {
  if (!config.value.speech.enabled) return t('settings.speech.status.disabledTitle');
  if (speechStatusLoading.value) return t('settings.speech.status.checkingTitle');
  if (speechStatus.value?.available) return t('settings.speech.status.readyTitle');
  return t('settings.speech.status.notReadyTitle');
});

const baseSpeechLanguages = computed<SpeechLanguageOption[]>(() => [
  { value: '', label: t('settings.speech.language.autoDetect') },
  { value: 'en', label: 'English' },
  { value: 'zh', label: '中文' },
  { value: 'ja', label: '日本語' },
  { value: 'ko', label: '한국어' },
  { value: 'de', label: 'Deutsch' },
  { value: 'fr', label: 'Français' },
  { value: 'es', label: 'Español' },
  { value: 'pt', label: 'Português' },
]);

const speechLanguageValue = computed(() => {
  const value = config.value.speech.language?.trim() || '';
  return value.toLowerCase() === 'auto' ? '' : value;
});

const speechLanguageOptions = computed(() => {
  const options = [...baseSpeechLanguages.value];
  const value = config.value.speech.language?.trim() || '';
  if (value && value.toLowerCase() !== 'auto' && !options.some(option => option.value === value)) {
    options.push({ value, label: t('settings.speech.language.custom', { value }) });
  }
  return options;
});

const speechStatusDetail = computed(() => {
  if (!config.value.speech.enabled) {
    return t('settings.speech.status.enableToUseVoice');
  }
  if (speechStatusLoading.value) {
    return t('settings.speech.status.validating');
  }
  if (speechStatus.value?.available) {
    const provider =
      speechStatus.value.providerType || config.value.speech.providerType || 'unknown';
    const model = speechStatus.value.model || config.value.speech.model || 'auto';
    return t('settings.speech.status.providerModel', { provider, model });
  }
  return speechStatus.value?.reason || t('settings.speech.status.checkSettings');
});

const speechStatusToneClass = computed(() => {
  if (!config.value.speech.enabled) return 'is-muted';
  if (speechStatusLoading.value) return 'is-muted';
  if (speechStatus.value?.available) return 'is-ready';
  return 'is-error';
});

const updateSpeech = <K extends keyof AppConfig['speech']>(
  key: K,
  value: AppConfig['speech'][K]
) => {
  config.value.speech[key] = value;
  emit('config-change');
};

const updateSpeechProviderSelection = (value: string) => {
  updateSpeech('providerType', value as AppConfig['speech']['providerType']);
};

const updateSpeechLanguageSelection = (value: string) => {
  updateSpeech('language', value);
};

const loadSpeechStatus = async () => {
  speechStatusLoading.value = true;
  if (!electronAPI?.speech?.getStatus) {
      speechStatus.value = {
        available: false,
        enabled: false,
        reason: t('settings.speech.error.serviceUnavailable'),
      };
    speechStatusLoading.value = false;
    return;
  }
  try {
    speechStatus.value = await electronAPI.speech.getStatus();
  } catch (error: unknown) {
      speechStatus.value = {
        available: false,
        enabled: false,
        reason: getErrorMessage(error) || t('settings.speech.error.serviceUnavailable'),
      };
  } finally {
    speechStatusLoading.value = false;
  }
};

const scheduleSpeechStatusRefresh = () => {
  if (speechStatusTimer !== null) {
    window.clearTimeout(speechStatusTimer);
  }
  speechStatusTimer = window.setTimeout(() => {
    speechStatusTimer = null;
    void loadSpeechStatus();
  }, 350);
};

const loadWhisperModels = async () => {
  whisperModelsLoading.value = true;
  whisperModelsError.value = '';
  if (!electronAPI?.speech?.listModels) {
    whisperModelsError.value = t('settings.speech.error.modelListUnavailable');
    whisperModelsLoading.value = false;
    return;
  }
  try {
    const models = await electronAPI.speech.listModels();
    whisperModels.value = Array.isArray(models) ? models : [];
  } catch (error: unknown) {
    whisperModelsError.value = t('settings.speech.error.loadModelsFailed', {
      error: getErrorMessage(error),
    });
  } finally {
    whisperModelsLoading.value = false;
  }
};

const downloadWhisperModel = async (modelName: string) => {
  if (!modelName) return;
  whisperModelStages.value[modelName] = 'downloading';
  whisperModelDownloadErrors.value[modelName] = '';
  whisperModelProgress.value[modelName] = {};
  if (!electronAPI?.speech?.downloadModel) {
    whisperModelDownloadErrors.value[modelName] = t('settings.speech.error.downloadUnavailable');
    whisperModelStages.value[modelName] = 'error';
    return;
  }
  try {
    const result = await electronAPI.speech.downloadModel(modelName);
    if (!result?.success) {
      whisperModelDownloadErrors.value[modelName] =
        result?.error || t('settings.speech.error.downloadFailed');
      whisperModelStages.value[modelName] = 'error';
    } else {
      whisperModelStages.value[modelName] = 'done';
      applyWhisperModel(modelName);
    }
    await loadWhisperModels();
    scheduleSpeechStatusRefresh();
  } catch (error: unknown) {
    whisperModelDownloadErrors.value[modelName] =
      getErrorMessage(error) || t('settings.speech.error.downloadFailed');
    whisperModelStages.value[modelName] = 'error';
  }
};

const applyWhisperModel = (modelName: string) => {
  if (!modelName) return;
  config.value.speech.providerType = 'whisper-node';
  config.value.speech.modelPath = '';
  config.value.speech.model = modelName;
  emit('config-change');
  scheduleSpeechStatusRefresh();
};

const handleWhisperDownloadProgress = (payload: WhisperNodeDownloadProgress) => {
  if (!payload || typeof payload !== 'object') return;
  const model = payload.model;
  if (!model) return;
  const stage = payload.stage as WhisperDownloadStage;
  if (!stage) return;
  whisperModelStages.value[model] = stage;
  if (typeof payload.progress === 'number') {
    whisperModelProgress.value[model] = {
      progress: payload.progress,
      downloadedBytes: payload.downloadedBytes,
      totalBytes: payload.totalBytes,
    };
  }
  if (stage === 'error') {
    whisperModelDownloadErrors.value[model] =
      payload.message ||
      whisperModelDownloadErrors.value[model] ||
      t('settings.speech.error.downloadFailed');
    whisperModelProgress.value[model] = {};
  }
  if (stage === 'done') {
    whisperModelDownloadErrors.value[model] = '';
    whisperModelProgress.value[model] = {};
    void loadWhisperModels();
    scheduleSpeechStatusRefresh();
  }
};

const getWhisperModelStage = (model: WhisperNodeModelInfo): WhisperDownloadStage => {
  if (model.downloaded) return 'done';
  return whisperModelStages.value[model.name] || 'idle';
};

const isWhisperModelSelected = (model: WhisperNodeModelInfo): boolean =>
  selectedWhisperModel.value === model.name;

const getWhisperProgressState = (model: WhisperNodeModelInfo): WhisperDownloadProgressState =>
  whisperModelProgress.value[model.name] || {};

const hasWhisperProgress = (model: WhisperNodeModelInfo): boolean =>
  typeof getWhisperProgressState(model).progress === 'number';

const getWhisperProgressStyle = (model: WhisperNodeModelInfo): Record<string, string> => {
  const progress = getWhisperProgressState(model).progress;
  if (typeof progress !== 'number') return {};
  const pct = Math.max(0, Math.min(100, Math.round(progress * 100)));
  return { width: `${pct}%` };
};

const getWhisperProgressClass = (
  model: WhisperNodeModelInfo,
  stage: WhisperDownloadStage
): string => {
  const classes: string[] = [stage];
  if (stage === 'compiling' || (stage === 'downloading' && !hasWhisperProgress(model))) {
    classes.push('is-indeterminate');
  }
  return classes.join(' ');
};

const handleWhisperModelAction = (model: WhisperNodeModelInfo) => {
  const stage = getWhisperModelStage(model);
  if (isWhisperStageBusy(stage)) return;
  if (model.downloaded) {
    applyWhisperModel(model.name);
    return;
  }
  void downloadWhisperModel(model.name);
};

const isWhisperStageBusy = (stage: WhisperDownloadStage): boolean =>
  stage === 'downloading' || stage === 'compiling';

const formatBytes = (value?: number): string => {
  if (!value || value <= 0) return '';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  const digits = size >= 10 || unitIndex === 0 ? 0 : 1;
  return `${size.toFixed(digits)} ${units[unitIndex]}`;
};

const getWhisperActionLabel = (model: WhisperNodeModelInfo): string => {
  if (model.status === 'invalid') return t('settings.speech.action.redownload');
  if (isWhisperModelSelected(model) && model.downloaded) return t('settings.speech.action.selected');
  if (model.downloaded) return t('settings.speech.action.use');
  const stage = getWhisperModelStage(model);
  if (stage === 'downloading') return t('settings.speech.action.downloading');
  if (stage === 'compiling') return t('settings.speech.action.compiling');
  if (stage === 'error') return t('settings.speech.action.retry');
  return t('settings.speech.action.downloadAndUse');
};

const getWhisperProgressText = (
  model: WhisperNodeModelInfo,
  stage: WhisperDownloadStage
): string => {
  if (stage === 'downloading') {
    const progressState = getWhisperProgressState(model);
    const progress =
      typeof progressState.progress === 'number' ? Math.round(progressState.progress * 100) : null;
    const total = progressState.totalBytes ? formatBytes(progressState.totalBytes) : '';
    const downloaded = progressState.downloadedBytes
      ? formatBytes(progressState.downloadedBytes)
      : '';
    const detail = downloaded && total ? `${downloaded} / ${total}` : total || downloaded || '';
    if (progress !== null) {
      return t('settings.speech.progress.downloadingDetailed', {
        model: model.name,
        progress,
        detail,
      });
    }
    return t('settings.speech.progress.downloadingSimple', {
      model: model.name,
      size: model.sizeMB,
    });
  }
  if (stage === 'compiling') {
    return t('settings.speech.progress.compiling');
  }
  if (stage === 'done') {
    return t('settings.speech.progress.ready');
  }
  if (stage === 'error') {
    return t('settings.speech.progress.failed');
  }
  if (model.status === 'invalid') {
    return t('settings.speech.progress.corrupted');
  }
  return '';
};

watch(
  () => props.active,
  active => {
    if (!active) return;
    void loadSpeechStatus();
    if (config.value.speech.providerType === 'whisper-node') {
      void loadWhisperModels();
    }
  },
  { immediate: true }
);

watch(
  () => config.value.speech.providerType,
  providerType => {
    if (providerType === 'whisper-node') {
      if (!config.value.speech.model || config.value.speech.model === 'whisper-1') {
        config.value.speech.model = 'base.en';
        emit('config-change');
      }
      if (props.active) {
        void loadWhisperModels();
      }
    }
  }
);

watch(
  () => config.value.speech,
  () => {
    if (props.active) {
      scheduleSpeechStatusRefresh();
    }
  },
  { deep: true }
);

onMounted(() => {
  try {
    electronAPI?.speech?.removeAllListeners?.();
    electronAPI?.speech?.onDownloadProgress?.((payload: WhisperNodeDownloadProgress) => {
      handleWhisperDownloadProgress(payload);
    });
  } catch {
    // ignore
  }
});

onUnmounted(() => {
  try {
    electronAPI?.speech?.removeAllListeners?.();
  } catch {
    // ignore
  }
  if (speechStatusTimer !== null) {
    window.clearTimeout(speechStatusTimer);
    speechStatusTimer = null;
  }
});
</script>

<style scoped src="./settings_shared.css"></style>

<style scoped>
.speech-models-card {
  border: 1px solid var(--border-color);
  border-radius: 12px;
  padding: 12px;
  background: var(--bg-secondary);
  margin-bottom: 12px;
}

.speech-models-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-weight: 600;
  margin-bottom: 10px;
}

.speech-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: 999px;
  border: 1px solid var(--border-color);
  background: transparent;
  color: var(--text-primary);
  font-size: 0.85em;
  transition: all 0.2s;
}

.speech-btn:hover:not(:disabled) {
  border-color: var(--accent-color);
  background: color-mix(in srgb, var(--accent-color) 12%, var(--bg-primary));
}

.speech-btn.is-primary {
  background: color-mix(in srgb, var(--accent-color) 22%, var(--bg-primary));
  border-color: color-mix(in srgb, var(--accent-color) 40%, var(--border-color));
}

.speech-btn.is-success {
  background: color-mix(in srgb, var(--success-color, var(--accent-color)) 18%, var(--bg-primary));
  border-color: color-mix(
    in srgb,
    var(--success-color, var(--accent-color)) 35%,
    var(--border-color)
  );
  color: var(--text-primary);
}

.speech-btn.is-danger {
  background: color-mix(in srgb, var(--danger-color) 18%, var(--bg-primary));
  border-color: color-mix(in srgb, var(--danger-color) 35%, var(--border-color));
}

.speech-btn.is-busy {
  opacity: 0.75;
}

.speech-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.speech-btn-spinner {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  border: 2px solid color-mix(in srgb, var(--accent-color) 40%, transparent);
  border-top-color: var(--accent-color);
  animation: speechSpin 0.8s linear infinite;
}

.speech-models-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.speech-model-row {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid var(--border-color);
  border-radius: 10px;
  background: var(--bg-primary);
}

.speech-model-row-main {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.speech-model-meta {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.speech-model-name {
  font-weight: 600;
}

.speech-model-stats {
  font-size: 0.85em;
  color: var(--text-secondary);
}

.speech-model-badge {
  display: inline-flex;
  align-items: center;
  align-self: flex-start;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 0.75em;
  color: var(--text-primary);
  background: color-mix(in srgb, var(--accent-color) 18%, var(--bg-primary));
  border: 1px solid color-mix(in srgb, var(--accent-color) 30%, var(--border-color));
}

.speech-model-badge.is-danger {
  background: color-mix(in srgb, var(--danger-color) 18%, var(--bg-primary));
  border-color: color-mix(in srgb, var(--danger-color) 35%, var(--border-color));
}

.speech-model-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.speech-model-progress {
  margin-top: 10px;
  width: 100%;
}

.speech-model-progress-track {
  height: 6px;
  width: 100%;
  background: var(--bg-secondary);
  border-radius: 999px;
  overflow: hidden;
  border: 1px solid var(--border-color);
}

.speech-model-progress-bar {
  height: 100%;
  width: 0%;
  background: linear-gradient(
    90deg,
    color-mix(in srgb, var(--accent-color) 60%, transparent),
    color-mix(in srgb, var(--accent-color) 90%, transparent)
  );
  border-radius: 999px;
  transition: width 0.2s ease;
}

.speech-model-progress-bar.is-indeterminate {
  width: 40%;
  animation: speechProgress 1.2s ease-in-out infinite;
}

.speech-model-progress-bar.compiling {
  background: linear-gradient(
    90deg,
    color-mix(in srgb, var(--accent-color) 50%, transparent),
    color-mix(in srgb, var(--accent-color) 80%, transparent)
  );
}

.speech-model-progress-text {
  display: inline-block;
  margin-top: 6px;
  font-size: 0.8em;
  color: var(--text-secondary);
}

.speech-models-empty {
  font-size: 0.9em;
  color: var(--text-secondary);
}

.speech-models-error,
.speech-model-error {
  font-size: 0.85em;
  color: var(--danger-color);
}

.speech-status {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid var(--border-color);
  background: var(--bg-primary);
  margin-bottom: 12px;
}

.speech-status.is-ready {
  border-color: color-mix(
    in srgb,
    var(--success-color, var(--accent-color)) 40%,
    var(--border-color)
  );
  background: color-mix(in srgb, var(--success-color, var(--accent-color)) 12%, var(--bg-primary));
}

.speech-status.is-error {
  border-color: color-mix(in srgb, var(--danger-color) 40%, var(--border-color));
  background: color-mix(in srgb, var(--danger-color) 12%, var(--bg-primary));
}

.speech-status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--text-secondary);
  margin-top: 6px;
  flex-shrink: 0;
}

.speech-status.is-ready .speech-status-dot {
  background: var(--success-color, var(--accent-color));
}

.speech-status.is-error .speech-status-dot {
  background: var(--danger-color);
}

.speech-status-title {
  font-weight: 600;
}

.speech-status-detail {
  font-size: 0.85em;
  color: var(--text-secondary);
  margin-top: 2px;
}

@keyframes speechProgress {
  0% {
    transform: translateX(-60%);
  }

  100% {
    transform: translateX(160%);
  }
}

@keyframes speechSpin {
  to {
    transform: rotate(360deg);
  }
}
</style>
