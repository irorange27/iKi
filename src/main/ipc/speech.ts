import { ipcMain } from 'electron';

import {
  getSpeechStatus,
  transcribeSpeech,
} from '../services/speech/speech_service';
import type { SpeechTranscriptionInput } from '../../shared/types/speech';

let speechIpcRegistered = false;

export const registerSpeechIpc = (): void => {
  if (speechIpcRegistered) return;
  speechIpcRegistered = true;

  ipcMain.handle('speech:get-status', () => {
    try {
      return getSpeechStatus();
    } catch (error: unknown) {
      console.error('Failed to get speech status:', error);
      return { available: false, reason: 'Speech service unavailable' };
    }
  });

  ipcMain.handle('speech:transcribe', async (_event, input: SpeechTranscriptionInput) => {
    try {
      return await transcribeSpeech(input);
    } catch (error: unknown) {
      console.error('Speech transcription failed:', error);
      throw error;
    }
  });
};
