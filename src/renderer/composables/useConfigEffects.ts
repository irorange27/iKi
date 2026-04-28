import { onMounted, onUnmounted, watch } from 'vue';
import type { AppConfig } from '../../shared/types/config';
import { resolveThemeSelection } from '../../shared/theme/registry';
import { THEME_SLOT_TO_CSS_VARIABLE } from '../../shared/theme/types';
import { getElectronApiMethod } from '../services/electron_api';
import { useConfigStore } from '../store/config';

const SYSTEM_THEME_QUERY = '(prefers-color-scheme: dark)';

type LegacyMediaQueryList = MediaQueryList & {
  addListener?: (listener: (event: MediaQueryListEvent) => void) => void;
  removeListener?: (listener: (event: MediaQueryListEvent) => void) => void;
};

let lastNativeWindowShadow: boolean | null = null;

const systemPrefersDark = (): boolean => {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia(SYSTEM_THEME_QUERY).matches;
};

const syncNativeWindowShadow = (resolvedTheme: 'light' | 'dark') => {
  const nextShadowState = resolvedTheme === 'light';
  if (lastNativeWindowShadow === nextShadowState) return;
  lastNativeWindowShadow = nextShadowState;
  getElectronApiMethod('setWindowShadow')?.(nextShadowState);
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
  const resolvedTheme = resolveThemeSelection({
    presetId: config.general.themePresetId,
    themeMode: config.general.theme,
    systemPrefersDark: systemPrefersDark(),
    base46Presets: config.themes.base46Presets,
  });

  const root = document.documentElement;
  root.style.setProperty('--font-size', `${fontSize}px`);
  root.style.setProperty('--chat-content-padding', `${chatContentPadding}px`);
  root.style.setProperty('--chat-composer-padding', `${composerPadding}px`);
  root.style.setProperty('--chat-bubble-padding-x', `${messageBubblePaddingX}px`);
  root.style.setProperty('--chat-bubble-padding-y', `${messageBubblePaddingY}px`);
  root.style.setProperty('--chat-message-gap', `${messageGap}px`);
  for (const [slot, variableName] of Object.entries(THEME_SLOT_TO_CSS_VARIABLE)) {
    const value = resolvedTheme.palette[slot as keyof typeof resolvedTheme.palette];
    if (typeof value === 'string') {
      root.style.setProperty(variableName, value);
    }
  }
  root.setAttribute('data-density', density);
  root.setAttribute('data-theme', resolvedTheme.resolvedVariant);
  root.setAttribute('data-theme-preset', resolvedTheme.presetId);
  syncNativeWindowShadow(resolvedTheme.resolvedVariant);
};

export const useConfigEffects = () => {
  const store = useConfigStore();

  const apply = () => applyCssVariables(store.config);

  const stopWatch = watch(
    () => ({ ui: store.config.ui, general: store.config.general, themes: store.config.themes }),
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
