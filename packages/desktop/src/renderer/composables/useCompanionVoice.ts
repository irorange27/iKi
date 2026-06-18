import { ref } from 'vue';
import { PHASE_VOICE } from './useCompanionSprites';

/**
 * Plays pre-recorded voice clips on companion phase transitions.
 * One Audio element reused — stops any in-progress clip before playing the next.
 */
export function useCompanionVoice() {
  const muted = ref(false);
  let currentAudio: HTMLAudioElement | null = null;

  const playPhaseVoice = (phase: string, nudgeKind?: string) => {
    if (muted.value) return;

    const key = phase === 'nudge'
      ? (nudgeKind === 'task-error' ? 'nudge-error' : 'nudge-success')
      : phase;

    const src = PHASE_VOICE[key];
    if (!src) return;

    if (currentAudio) {
      currentAudio.pause();
      currentAudio = null;
    }

    const audio = new Audio(src);
    audio.volume = 0.7;
    audio.play().catch(() => {
      // Browser may block autoplay; that's fine, just skip.
    });
    currentAudio = audio;
  };

  const setMuted = (value: boolean) => {
    muted.value = value;
    if (value && currentAudio) {
      currentAudio.pause();
      currentAudio = null;
    }
  };

  return { muted, playPhaseVoice, setMuted };
}
