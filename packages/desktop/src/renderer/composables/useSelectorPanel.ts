import { onUnmounted, ref } from 'vue';

export const SELECTOR_CLOSE_DELAY_MS = 320;

/**
 * Shared hover-panel mechanics for the composer selector family: the panel
 * opens immediately on hover and closes on a short delay, so moving between
 * the trigger and the panel never flickers. `onOpen` fires on every open
 * (callers throttle their own reloads); `onClose` fires on each open→close
 * transition, including the scheduled close.
 */
export const useSelectorPanel = (options?: {
  closeDelayMs?: number;
  onOpen?: () => void;
  onClose?: () => void;
}) => {
  const isOpen = ref(false);
  let closeTimer: ReturnType<typeof setTimeout> | null = null;

  const clearCloseTimer = () => {
    if (closeTimer !== null) {
      window.clearTimeout(closeTimer);
      closeTimer = null;
    }
  };

  const openPanel = () => {
    clearCloseTimer();
    if (isOpen.value) return;
    isOpen.value = true;
    options?.onOpen?.();
  };

  const closePanel = () => {
    clearCloseTimer();
    if (!isOpen.value) return;
    isOpen.value = false;
    options?.onClose?.();
  };

  const scheduleClosePanel = () => {
    if (closeTimer !== null) window.clearTimeout(closeTimer);
    closeTimer = setTimeout(() => {
      closeTimer = null;
      if (!isOpen.value) return;
      isOpen.value = false;
      options?.onClose?.();
    }, options?.closeDelayMs ?? SELECTOR_CLOSE_DELAY_MS);
  };

  const togglePanel = () => {
    if (isOpen.value) {
      closePanel();
    } else {
      openPanel();
    }
  };

  onUnmounted(clearCloseTimer);

  return { isOpen, openPanel, closePanel, scheduleClosePanel, togglePanel };
};
