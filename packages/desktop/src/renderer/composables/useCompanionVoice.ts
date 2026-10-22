import { ref } from 'vue';
import { PHASE_VOICE } from './useCompanionSprites';

export function useCompanionVoice() {
  const muted = ref(false);
  let currentAudio: HTMLAudioElement | null = null;

  const playPhaseVoice = (phase: string) => {
    if (muted.value) return;

    const src = PHASE_VOICE[phase];
    if (!src) return;

    if (currentAudio) {
      currentAudio.pause();
      currentAudio = null;
    }

    const audio = new Audio(src);
    audio.volume = 0.7;
    audio.play().catch(() => {
      /* autoplay can be blocked by the browser; the voice simply stays silent */
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
