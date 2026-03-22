import { ipcMain } from 'electron';

import { createLogger } from '../../core/logger';
import {
  downloadWhisperNodeModel,
  getSpeechStatus,
  listWhisperNodeModels,
  transcribeSpeech,
} from '../services/speech/speech_service';
import type { SpeechTranscriptionInput } from '../../shared/types/speech';

let speechIpcRegistered = false;
const speechIpcLogger = createLogger({ module: 'speech_ipc' });

export const registerSpeechIpc = (): void => {
  if (speechIpcRegistered) return;
  speechIpcRegistered = true;

  ipcMain.handle('speech:get-status', () => {
    try {
      return getSpeechStatus();
    } catch (error: unknown) {
      speechIpcLogger.event({
        level: 'error',
        event: 'ipc.speech.get_status',
        outcome: 'failed',
        error,
      });
      return { available: false, reason: 'Speech service unavailable' };
    }
  });

  ipcMain.handle('speech:transcribe', async (_event, input: SpeechTranscriptionInput) => {
    try {
      return await transcribeSpeech(input);
    } catch (error: unknown) {
      speechIpcLogger.event({
        level: 'error',
        event: 'ipc.speech.transcribe',
        outcome: 'failed',
        error,
      });
      throw error;
    }
  });

  ipcMain.handle('speech:list-models', () => {
    try {
      return listWhisperNodeModels();
    } catch (error: unknown) {
      speechIpcLogger.event({
        level: 'error',
        event: 'ipc.speech.list_models',
        outcome: 'failed',
        error,
      });
      return [];
    }
  });

  ipcMain.handle('speech:download-model', async (event, modelName: string) => {
    try {
      return await downloadWhisperNodeModel(modelName, payload => {
        event.sender.send('speech:download-progress', payload);
      });
    } catch (error: unknown) {
      speechIpcLogger.event({
        level: 'error',
        event: 'ipc.speech.download_model',
        outcome: 'failed',
        error,
        entity: {
          model: modelName,
        },
      });
      return {
        model: modelName,
        success: false,
        error: error instanceof Error ? error.message : 'Download failed',
      };
    }
  });
};
