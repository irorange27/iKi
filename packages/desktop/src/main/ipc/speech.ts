import { ipcMain } from 'electron';

import { createLogger } from '@iki/backend/logger';
import { getErrorMessage } from '@iki/backend/utils/errors';
import {
  downloadWhisperNodeModel,
  getSpeechStatus,
  listWhisperNodeModels,
  transcribeSpeech,
} from '../services/speech/speech_service';
import type { SpeechTranscriptionInput } from '@iki/backend/types/speech';
import { withIpcLogging } from '../utils/ipc_helpers';

let speechIpcRegistered = false;
const speechIpcLogger = createLogger({ module: 'speech_ipc' });

export const registerSpeechIpc = (): void => {
  if (speechIpcRegistered) return;
  speechIpcRegistered = true;

  ipcMain.handle('speech:get-status', () =>
    withIpcLogging<ReturnType<typeof getSpeechStatus>>(speechIpcLogger, 'ipc.speech.get_status', () => getSpeechStatus(), {
      onError: () => ({ available: false, reason: 'Speech service unavailable' }),
    })
  );

  ipcMain.handle('speech:transcribe', (_event, input: SpeechTranscriptionInput) =>
    withIpcLogging<Awaited<ReturnType<typeof transcribeSpeech>>>(speechIpcLogger, 'ipc.speech.transcribe', () => transcribeSpeech(input), {
      onError: error => {
        throw error;
      },
    })
  );

  ipcMain.handle('speech:list-models', () =>
    withIpcLogging<Awaited<ReturnType<typeof listWhisperNodeModels>>>(speechIpcLogger, 'ipc.speech.list_models', () => listWhisperNodeModels(), {
      onError: () => [],
    })
  );

  ipcMain.handle('speech:download-model', (event, modelName: string) =>
    withIpcLogging(
      speechIpcLogger,
      'ipc.speech.download_model',
      () =>
        downloadWhisperNodeModel(modelName, payload => {
          event.sender.send('speech:download-progress', payload);
        }),
      {
        entity: { model: modelName },
        onError: error => ({
          model: modelName,
          success: false,
          error: getErrorMessage(error),
        }),
      }
    )
  );
};
