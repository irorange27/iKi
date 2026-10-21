import { ref, readonly } from 'vue';

export function useSpriteTransition(defaultSrc = '') {
  const FADE_MS = 300;

  const oldSrc = ref(defaultSrc);
  const newSrc = ref('');
  const oldOpacity = ref(1);
  const newOpacity = ref(0);
  const phase = ref<'idle' | 'fading'>('idle');

  let fadeTimer: ReturnType<typeof setTimeout> | null = null;

  const setInitial = (src: string) => {
    clearFadeTimer();
    oldSrc.value = src;
    newSrc.value = '';
    oldOpacity.value = 1;
    newOpacity.value = 0;
    phase.value = 'idle';
  };

  const setSprite = (src: string) => {
    if (phase.value === 'fading' || !src || src === oldSrc.value) return;

    clearFadeTimer();
    newSrc.value = src;
    phase.value = 'fading';

    requestAnimationFrame(() => {
      oldOpacity.value = 0;
      newOpacity.value = 1;
    });

    fadeTimer = setTimeout(() => {
      oldSrc.value = src;
      newSrc.value = '';
      oldOpacity.value = 1;
      newOpacity.value = 0;
      phase.value = 'idle';
    }, FADE_MS);
  };

  const clearFadeTimer = () => {
    if (fadeTimer !== null) {
      clearTimeout(fadeTimer);
      fadeTimer = null;
    }
  };

  return {
    oldSrc: readonly(oldSrc),
    newSrc: readonly(newSrc),
    oldOpacity: readonly(oldOpacity),
    newOpacity: readonly(newOpacity),
    phase: readonly(phase),
    setInitial,
    setSprite,
  };
}
