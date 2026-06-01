import { computed, nextTick, onUnmounted, ref } from 'vue';
import type { Ref } from 'vue';
import type { AudioEmotionResult, SpeechStatus } from '../../shared/types/speech';
import { createLogger } from '../logger';
import { translate } from '../i18n';
import { getElectronApiSliceMethod } from '../services/electron_api';

type SpeechInputOptions = {
  inputRef: Ref<HTMLInputElement | HTMLTextAreaElement | null>;
  message: Ref<string>;
};

type SpeechInputState = {
  speechStatus: Ref<SpeechStatus | null>;
  isRecording: Ref<boolean>;
  isTranscribing: Ref<boolean>;
  speechStatusLabel: Ref<string>;
  speechStatusToneClass: Ref<string>;
  speechEngineAvailable: Ref<boolean>;
  showWaveform: Ref<boolean>;
  waveformBars: Ref<number[]>;
  audioEmotion: Ref<AudioEmotionResult | null>;
  loadSpeechStatus: () => Promise<void>;
  toggleVoiceInput: () => Promise<void>;
  stopVoiceInput: () => void;
};

const WAVEFORM_BAR_COUNT = 5;
const speechInputLogger = createLogger({ module: 'speech_input' });

export const useSpeechInput = ({ inputRef, message }: SpeechInputOptions): SpeechInputState => {
  const getSpeechStatus = getElectronApiSliceMethod('speech', 'getStatus');
  const transcribeSpeech = getElectronApiSliceMethod('speech', 'transcribe');
  const speechStatus = ref<SpeechStatus | null>(null);
  const isRecording = ref(false);
  const isTranscribing = ref(false);
  const speechError = ref('');
  const speechErrorTimer = ref<number | null>(null);
  const speechDraftBase = ref('');
  const mediaRecorder = ref<MediaRecorder | null>(null);
  const mediaStream = ref<MediaStream | null>(null);
  const recordingTimeout = ref<number | null>(null);
  const audioEmotion = ref<AudioEmotionResult | null>(null);
  const waveformBars = ref<number[]>(Array.from({ length: WAVEFORM_BAR_COUNT }, () => 0.2));
  const showWaveform = computed(() => isRecording.value && Boolean(mediaStream.value));

  const isNodeSpeechAvailable = computed(() => Boolean(speechStatus.value?.available));
  const isSpeechEnabled = computed(() => speechStatus.value?.enabled === true);
  const requestedSpeechProvider = computed(() => speechStatus.value?.providerType);
  const canRecordAudio = computed(
    () => Boolean(navigator?.mediaDevices?.getUserMedia) && typeof MediaRecorder !== 'undefined'
  );
  const speechEngine = computed<'node' | 'none'>(() => {
    if (!isSpeechEnabled.value) return 'none';
    if (requestedSpeechProvider.value) {
      return isNodeSpeechAvailable.value && canRecordAudio.value ? 'node' : 'none';
    }
    return isNodeSpeechAvailable.value && canRecordAudio.value ? 'node' : 'none';
  });
  const speechEngineAvailable = computed(() => speechEngine.value !== 'none');
  const speechStatusLabel = computed(() => speechError.value);
  const speechStatusToneClass = computed(() =>
    speechError.value ? 'ui-text-danger' : 'ui-text-muted'
  );

  const loadSpeechStatus = async () => {
    if (!getSpeechStatus) {
      speechStatus.value = { available: false, reason: translate('chat.speech.unavailable') };
      return;
    }
    try {
      speechStatus.value = await getSpeechStatus();
    } catch (error) {
      speechInputLogger.event({
        level: 'error',
        event: 'speech.status.load',
        outcome: 'failed',
        error,
      });
      speechStatus.value = { available: false, reason: translate('chat.speech.unavailable') };
    }
  };

  const clearSpeechError = () => {
    speechError.value = '';
    if (speechErrorTimer.value !== null) {
      window.clearTimeout(speechErrorTimer.value);
      speechErrorTimer.value = null;
    }
  };

  const setSpeechError = (nextMessage: string) => {
    speechError.value = nextMessage;
    if (speechErrorTimer.value !== null) {
      window.clearTimeout(speechErrorTimer.value);
    }
    speechErrorTimer.value = window.setTimeout(() => {
      clearSpeechError();
    }, 4000);
  };

  const applySpeechText = async (text: string) => {
    const trimmed = text.trim().replace(/\s+/g, ' ');
    if (!trimmed) return;
    const input = inputRef.value;
    if (!input) {
      message.value = `${speechDraftBase.value} ${trimmed}`.trim();
      return;
    }
    const current = message.value || '';
    const start = typeof input.selectionStart === 'number' ? input.selectionStart : current.length;
    const end = typeof input.selectionEnd === 'number' ? input.selectionEnd : current.length;
    const prefix = current.slice(0, start);
    const suffix = current.slice(end);
    let insert = trimmed;
    if (prefix && !/\s$/.test(prefix)) {
      insert = ` ${insert}`;
    }
    if (suffix && !/^\s/.test(suffix)) {
      insert = `${insert} `;
    }
    message.value = `${prefix}${insert}${suffix}`.trim();
    await nextTick();
    const cursor = (prefix + insert).length;
    input.setSelectionRange(cursor, cursor);
    input.focus();
  };

  const resetSpeechDraft = () => {
    speechDraftBase.value = message.value;
  };

  const getTranscriptionLanguage = () => {
    const locale = navigator?.language || 'en';
    return locale.split('-')[0];
  };

  const pickRecordingMimeType = () => {
    if (typeof MediaRecorder === 'undefined') return '';
    const candidates = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/ogg;codecs=opus',
      'audio/ogg',
    ];
    return candidates.find(type => MediaRecorder.isTypeSupported(type)) || '';
  };

  let waveformAudioContext: AudioContext | null = null;
  let waveformAnalyser: AnalyserNode | null = null;
  let waveformSource: MediaStreamAudioSourceNode | null = null;
  let waveformRafId: number | null = null;

  const resetWaveformBars = () => {
    waveformBars.value = Array.from({ length: WAVEFORM_BAR_COUNT }, () => 0.2);
  };

  const updateWaveform = () => {
    if (!waveformAnalyser) return;
    const data = new Uint8Array(waveformAnalyser.frequencyBinCount);
    waveformAnalyser.getByteFrequencyData(data);
    const step = Math.max(1, Math.floor(data.length / WAVEFORM_BAR_COUNT));
    const nextBars = new Array(WAVEFORM_BAR_COUNT).fill(0).map((_, index) => {
      const start = index * step;
      let sum = 0;
      for (let i = 0; i < step; i += 1) {
        sum += data[start + i] || 0;
      }
      const avg = sum / step / 255;
      return Math.min(1, Math.pow(avg * 1.4, 0.8));
    });
    waveformBars.value = nextBars;
    waveformRafId = window.requestAnimationFrame(updateWaveform);
  };

  const startWaveform = (stream?: MediaStream | null) => {
    stopWaveform();
    resetWaveformBars();
    const AudioContextCtor =
      window.AudioContext ||
      (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!stream || !AudioContextCtor) return;
    try {
      waveformAudioContext = new AudioContextCtor();
      waveformAnalyser = waveformAudioContext.createAnalyser();
      waveformAnalyser.fftSize = 256;
      waveformAnalyser.smoothingTimeConstant = 0.75;
      waveformSource = waveformAudioContext.createMediaStreamSource(stream);
      waveformSource.connect(waveformAnalyser);
      if (typeof waveformAudioContext.resume === 'function') {
        waveformAudioContext.resume().catch((): void => undefined);
      }
      waveformRafId = window.requestAnimationFrame(updateWaveform);
    } catch (error) {
      speechInputLogger.event({
        level: 'warn',
        event: 'speech.waveform.start',
        outcome: 'degraded',
        error,
      });
    }
  };

  const stopWaveform = () => {
    if (waveformRafId !== null) {
      window.cancelAnimationFrame(waveformRafId);
      waveformRafId = null;
    }
    if (waveformSource) {
      try {
        waveformSource.disconnect();
      } catch {
        // Ignore disconnect errors
      }
      waveformSource = null;
    }
    if (waveformAnalyser) {
      try {
        waveformAnalyser.disconnect();
      } catch {
        // Ignore disconnect errors
      }
      waveformAnalyser = null;
    }
    if (waveformAudioContext) {
      const context = waveformAudioContext;
      waveformAudioContext = null;
      if (typeof context.close === 'function') {
        context.close().catch((): void => undefined);
      }
    }
    resetWaveformBars();
  };

  const clearRecordingTimeout = () => {
    if (recordingTimeout.value !== null) {
      window.clearTimeout(recordingTimeout.value);
      recordingTimeout.value = null;
    }
  };

  const stopMediaTracks = () => {
    stopWaveform();
    if (mediaStream.value) {
      mediaStream.value.getTracks().forEach(track => track.stop());
      mediaStream.value = null;
    }
    mediaRecorder.value = null;
  };

  const blobToBase64 = (blob: Blob): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result !== 'string') {
          reject(new Error('Failed to read audio data'));
          return;
        }
        const base64 = reader.result.split(',')[1];
        resolve(base64 || '');
      };
      reader.onerror = () => {
        reject(reader.error || new Error('Failed to read audio data'));
      };
      reader.onabort = () => {
        reject(new DOMException('Aborted', 'AbortError'));
      };
      reader.readAsDataURL(blob);
    });

  const transcribeRecording = async (blob: Blob) => {
    if (!blob || blob.size === 0) return;
    if (!transcribeSpeech) {
      setSpeechError(translate('chat.speech.unavailable'));
      return;
    }
    isTranscribing.value = true;
    try {
      const audioBase64 = await blobToBase64(blob);
      const providerType = speechStatus.value?.providerType;
      const languageHint =
        providerType === 'openai'
          ? speechStatus.value?.language || getTranscriptionLanguage()
          : speechStatus.value?.language;
      const result = await transcribeSpeech({
        audioBase64,
        mimeType: blob.type || 'audio/webm',
        language: languageHint,
        prompt: providerType === 'openai' ? speechStatus.value?.prompt : undefined,
        model: speechStatus.value?.model,
      });
      const text = typeof result?.text === 'string' ? result.text : '';
      audioEmotion.value = result?.audioEmotion ?? null;
      if (text.trim()) {
        await applySpeechText(text);
      } else {
        setSpeechError(translate('chat.speech.noSpeechDetected'));
      }
    } catch (error) {
      speechInputLogger.event({
        level: 'error',
        event: 'speech.transcribe',
        outcome: 'failed',
        error,
      });
      setSpeechError(translate('chat.speech.transcriptionFailed'));
    } finally {
      isTranscribing.value = false;
    }
  };

  const startNodeRecording = async () => {
    if (!canRecordAudio.value) {
      setSpeechError(translate('chat.speech.microphoneUnavailable'));
      return;
    }
    clearSpeechError();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStream.value = stream;
      startWaveform(stream);

      const mimeType = pickRecordingMimeType();
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);

      const chunks: BlobPart[] = [];
      recorder.ondataavailable = event => {
        if (event.data && event.data.size > 0) {
          chunks.push(event.data);
        }
      };
      recorder.onerror = event => {
        speechInputLogger.event({
          level: 'error',
          event: 'speech.recording',
          outcome: 'failed',
          message: 'Recording error.',
          data: {
            event,
          },
        });
        setSpeechError(translate('chat.speech.recordingFailed'));
        isRecording.value = false;
        stopMediaTracks();
      };
      recorder.onstop = async () => {
        clearRecordingTimeout();
        isRecording.value = false;
        const blob = new Blob(chunks, { type: recorder.mimeType || mimeType || 'audio/webm' });
        stopMediaTracks();
        await transcribeRecording(blob);
      };

      mediaRecorder.value = recorder;
      resetSpeechDraft();
      recorder.start();
      isRecording.value = true;

      clearRecordingTimeout();
      recordingTimeout.value = window.setTimeout(() => {
        if (isRecording.value) {
          stopNodeRecording();
        }
      }, 60000);
    } catch (error) {
      speechInputLogger.event({
        level: 'error',
        event: 'speech.recording.start',
        outcome: 'failed',
        error,
      });
      setSpeechError(translate('chat.speech.permissionDenied'));
      stopMediaTracks();
    }
  };

  const stopNodeRecording = () => {
    clearRecordingTimeout();
    if (mediaRecorder.value && mediaRecorder.value.state !== 'inactive') {
      mediaRecorder.value.stop();
      return;
    }
    isRecording.value = false;
    stopMediaTracks();
  };

  const stopVoiceInput = () => {
    if (mediaRecorder.value || isRecording.value) {
      stopNodeRecording();
    }
  };

  const toggleVoiceInput = async () => {
    if (isTranscribing.value) return;
    if (isRecording.value) {
      stopVoiceInput();
      return;
    }
    if (!speechEngineAvailable.value) {
      await loadSpeechStatus();
      if (!speechEngineAvailable.value) {
        setSpeechError(
          speechStatus.value?.reason || translate('chat.speech.voiceInputUnavailable')
        );
        return;
      }
    }
    if (speechEngine.value !== 'node') {
      setSpeechError(speechStatus.value?.reason || translate('chat.speech.voiceInputUnavailable'));
      return;
    }
    await startNodeRecording();
  };

  onUnmounted(() => {
    if (speechErrorTimer.value !== null) {
      window.clearTimeout(speechErrorTimer.value);
      speechErrorTimer.value = null;
    }
    clearRecordingTimeout();
    stopVoiceInput();
    stopWaveform();
  });

  return {
    speechStatus,
    isRecording,
    isTranscribing,
    speechStatusLabel,
    speechStatusToneClass,
    speechEngineAvailable,
    showWaveform,
    waveformBars,
    audioEmotion,
    loadSpeechStatus,
    toggleVoiceInput,
    stopVoiceInput,
  };
};
