import { onMounted, onUnmounted, watch } from 'vue';
import type { AppConfig } from '../../shared/types/config';
import { useConfigStore } from '../store/config';

const SYSTEM_THEME_QUERY = '(prefers-color-scheme: dark)';

type LegacyMediaQueryList = MediaQueryList & {
  addListener?: (listener: (event: MediaQueryListEvent) => void) => void;
  removeListener?: (listener: (event: MediaQueryListEvent) => void) => void;
};

type WindowWithChromeApi = Window & {
  electronAPI?: {
    setWindowShadow?: (enabled: boolean) => void;
  };
};

let lastNativeWindowShadow: boolean | null = null;

const resolveTheme = (theme: AppConfig['general']['theme']): 'light' | 'dark' => {
  if (theme !== 'system') return theme;
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'light';
  return window.matchMedia(SYSTEM_THEME_QUERY).matches ? 'dark' : 'light';
};

const syncNativeWindowShadow = (resolvedTheme: 'light' | 'dark') => {
  if (typeof window === 'undefined') return;
  const nextShadowState = resolvedTheme === 'light';
  if (lastNativeWindowShadow === nextShadowState) return;
  lastNativeWindowShadow = nextShadowState;
  (window as WindowWithChromeApi).electronAPI?.setWindowShadow?.(nextShadowState);
};

export const applyCssVariables = (config: AppConfig) => {
  if (typeof document === 'undefined') return;
  const {
    fontSize,
    density,
    chatContentPadding,
    composerPadding,
    messageBubblePaddingX,
    messageBubblePaddingY,
    messageGap,
  } = config.ui;
  const resolvedTheme = resolveTheme(config.general.theme);

  const root = document.documentElement;
  root.style.setProperty('--font-size', `${fontSize}px`);
  root.style.setProperty('--chat-content-padding', `${chatContentPadding}px`);
  root.style.setProperty('--chat-composer-padding', `${composerPadding}px`);
  root.style.setProperty('--chat-bubble-padding-x', `${messageBubblePaddingX}px`);
  root.style.setProperty('--chat-bubble-padding-y', `${messageBubblePaddingY}px`);
  root.style.setProperty('--chat-message-gap', `${messageGap}px`);
  root.setAttribute('data-density', density);
  root.setAttribute('data-theme', resolvedTheme);
  syncNativeWindowShadow(resolvedTheme);
};

export const useConfigEffects = () => {
  const store = useConfigStore();

  const apply = () => applyCssVariables(store.config);

  const stopWatch = watch(
    () => [store.config.ui, store.config.general],
    () => apply(),
    { deep: true, immediate: true }
  );

  let media: LegacyMediaQueryList | null = null;
  const handleMediaChange = () => {
    if (store.config.general.theme === 'system') {
      apply();
    }
  };
  const legacyMediaChangeListener = () => {
    handleMediaChange();
  };

  onMounted(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    media = window.matchMedia(SYSTEM_THEME_QUERY) as LegacyMediaQueryList;
    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', handleMediaChange);
    } else if (typeof media.addListener === 'function') {
      // Legacy Electron/Chromium fallback.
      media.addListener(legacyMediaChangeListener);
    }
  });

  onUnmounted(() => {
    stopWatch();
    if (!media) return;
    if (typeof media.removeEventListener === 'function') {
      media.removeEventListener('change', handleMediaChange);
    } else if (typeof media.removeListener === 'function') {
      media.removeListener(legacyMediaChangeListener);
    }
  });
};
