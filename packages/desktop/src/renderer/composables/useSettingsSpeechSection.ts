import { computed, onMounted, onUnmounted, ref, watch, type Ref } from 'vue';
import { storeToRefs } from 'pinia';

import { useI18n } from '../i18n';
import { getElectronApiSliceMethod } from '../services/electron_api';
import { useConfigStore } from '../store/config';
import type { AppConfig } from '@iki/core/types/config';
import type {
  SpeechStatus,
  WhisperNodeDownloadProgress,
  WhisperNodeModelInfo,
} from '@iki/core/types/speech';
import { getErrorMessage } from '@iki/core/utils/errors';

type WhisperDownloadStage = 'idle' | 'downloading' | 'compiling' | 'done' | 'error';
type WhisperDownloadProgressState = {
  progress?: number;
  downloadedBytes?: number;
  totalBytes?: number;
};
type SpeechLanguageOption = { value: string; label: string };

export const useSettingsSpeechSection = (params: {
  active: Readonly<Ref<boolean>>;
  onConfigChange: () => void;
}) => {
  const { t } = useI18n();
  const getSpeechStatus = getElectronApiSliceMethod('speech', 'getStatus');
  const listSpeechModels = getElectronApiSliceMethod('speech', 'listModels');
  const downloadSpeechModel = getElectronApiSliceMethod('speech', 'downloadModel');
  const subscribeSpeechDownloadProgress = getElectronApiSliceMethod('speech', 'onDownloadProgress');

  const configStore = useConfigStore();
  const { config } = storeToRefs(configStore);

  const speechStatus = ref<SpeechStatus | null>(null);
  const speechStatusLoading = ref(false);
  let speechStatusTimer: number | null = null;
  let removeDownloadProgressListener: () => void = () => undefined;
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
    params.onConfigChange();
  };

  const updateSpeechProviderSelection = (value: string) => {
    updateSpeech('providerType', value as AppConfig['speech']['providerType']);
  };

  const updateSpeechLanguageSelection = (value: string) => {
    updateSpeech('language', value);
  };

  const loadSpeechStatus = async () => {
    speechStatusLoading.value = true;
    if (!getSpeechStatus) {
      speechStatus.value = {
        available: false,
        enabled: false,
        reason: t('settings.speech.error.serviceUnavailable'),
      };
      speechStatusLoading.value = false;
      return;
    }
    try {
      speechStatus.value = await getSpeechStatus();
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
    if (!listSpeechModels) {
      whisperModelsError.value = t('settings.speech.error.modelListUnavailable');
      whisperModelsLoading.value = false;
      return;
    }
    try {
      const models = await listSpeechModels();
      whisperModels.value = Array.isArray(models) ? models : [];
    } catch (error: unknown) {
      whisperModelsError.value = t('settings.speech.error.loadModelsFailed', {
        error: getErrorMessage(error),
      });
    } finally {
      whisperModelsLoading.value = false;
    }
  };

  const applyWhisperModel = (modelName: string) => {
    if (!modelName) return;
    config.value.speech.providerType = 'whisper-node';
    config.value.speech.modelPath = '';
    config.value.speech.model = modelName;
    params.onConfigChange();
    scheduleSpeechStatusRefresh();
  };

  const downloadWhisperModel = async (modelName: string) => {
    if (!modelName) return;
    whisperModelStages.value[modelName] = 'downloading';
    whisperModelDownloadErrors.value[modelName] = '';
    whisperModelProgress.value[modelName] = {};
    if (!downloadSpeechModel) {
      whisperModelDownloadErrors.value[modelName] = t('settings.speech.error.downloadUnavailable');
      whisperModelStages.value[modelName] = 'error';
      return;
    }
    try {
      const result = await downloadSpeechModel(modelName);
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

  const isWhisperStageBusy = (stage: WhisperDownloadStage): boolean =>
    stage === 'downloading' || stage === 'compiling';

  const handleWhisperModelAction = (model: WhisperNodeModelInfo) => {
    const stage = getWhisperModelStage(model);
    if (isWhisperStageBusy(stage)) return;
    if (model.downloaded) {
      applyWhisperModel(model.name);
      return;
    }
    void downloadWhisperModel(model.name);
  };

  const formatBytes = (value?: number): string => {
    if (typeof value !== 'number' || value <= 0) return '';
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
    params.active,
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
          params.onConfigChange();
        }
        if (params.active.value) {
          void loadWhisperModels();
        }
      }
    }
  );

  watch(
    () => config.value.speech,
    () => {
      if (params.active.value) {
        scheduleSpeechStatusRefresh();
      }
    },
    { deep: true }
  );

  onMounted(() => {
    try {
      removeDownloadProgressListener();
      removeDownloadProgressListener =
        subscribeSpeechDownloadProgress?.((payload: WhisperNodeDownloadProgress) => {
          handleWhisperDownloadProgress(payload);
        }) ?? (() => undefined);
    } catch {
      // ignore
    }
  });

  onUnmounted(() => {
    try {
      removeDownloadProgressListener();
    } catch {
      // ignore
    }
    if (speechStatusTimer !== null) {
      window.clearTimeout(speechStatusTimer);
      speechStatusTimer = null;
    }
  });

  return {
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
    speechStatusLoading,
    updateSpeech,
    updateSpeechLanguageSelection,
    updateSpeechProviderSelection,
    whisperModelDownloadErrors,
    whisperModels,
    whisperModelsError,
    whisperModelsLoading,
  };
};
