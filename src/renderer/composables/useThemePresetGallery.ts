import { computed, ref, type Ref } from 'vue';

import {
  DEFAULT_THEME_PRESET_ID,
  listThemePresetSummaries,
  resolveThemeSelection,
} from '../../shared/theme/registry';
import type { ThemePresetSummary, ThemeSlotPalette, ThemeVariant } from '../../shared/theme/types';
import type { AppConfig } from '../../shared/types/config';

export type ThemePresetCard = ThemePresetSummary & {
  swatches: string[];
};

const capitalizeWord = (value: string): string =>
  value ? `${value.charAt(0).toUpperCase()}${value.slice(1)}` : value;

const createPresetSwatches = (palette: ThemeSlotPalette): string[] => [
  palette.bgPrimary,
  palette.accentColor,
  palette.successColor,
  palette.dangerColor,
  palette.chart4,
  palette.textPrimary,
];

export const useThemePresetGallery = ({
  config,
  onConfigChange,
  systemPrefersDark,
}: {
  config: Ref<AppConfig>;
  onConfigChange: () => void;
  systemPrefersDark: () => boolean;
}) => {
  const themeOptions = ['light', 'dark', 'system'] as const;
  const searchQuery = ref('');

  const themePresetSummaries = computed(() =>
    listThemePresetSummaries(config.value.themes.base46Presets)
  );
  const customPresetIds = computed(() => new Set(Object.keys(config.value.themes.base46Presets)));

  const currentThemePresetId = computed(() => {
    const configured = config.value.general.themePresetId;
    return themePresetSummaries.value.some(preset => preset.id === configured)
      ? configured
      : DEFAULT_THEME_PRESET_ID;
  });

  const selectedPresetLabel = computed(
    () =>
      themePresetSummaries.value.find(preset => preset.id === currentThemePresetId.value)?.label ??
      'iKi Default'
  );

  const normalizedSearch = computed(() => searchQuery.value.trim().toLowerCase());

  const filteredThemePresets = computed(() => {
    if (!normalizedSearch.value) return themePresetSummaries.value;
    return themePresetSummaries.value.filter(preset =>
      `${preset.label} ${preset.id}`.toLowerCase().includes(normalizedSearch.value)
    );
  });

  const customPresetSummaries = computed(() =>
    themePresetSummaries.value.filter(preset => customPresetIds.value.has(preset.id))
  );

  const activeGalleryVariant = computed<ThemeVariant>(() => {
    if (config.value.general.theme === 'system') {
      return systemPrefersDark() ? 'dark' : 'light';
    }
    return config.value.general.theme;
  });

  const gallerySectionTitle = computed(() =>
    activeGalleryVariant.value === 'light' ? 'Light Theme Gallery' : 'Dark Theme Gallery'
  );

  const resolvePaletteForPreset = (presetId: string): ThemeSlotPalette =>
    resolveThemeSelection({
      presetId,
      themeMode: config.value.general.theme,
      systemPrefersDark: systemPrefersDark(),
      base46Presets: config.value.themes.base46Presets,
    }).palette;

  const buildPresetCards = (filterFn: (preset: ThemePresetSummary) => boolean) =>
    computed<ThemePresetCard[]>(() =>
      filteredThemePresets.value.filter(filterFn).map(preset => ({
        ...preset,
        swatches: createPresetSwatches(resolvePaletteForPreset(preset.id)),
      }))
    );

  const filteredCustomPresetCards = buildPresetCards(preset => customPresetIds.value.has(preset.id));
  const filteredBuiltinPresetCards = buildPresetCards(
    preset => !customPresetIds.value.has(preset.id)
  );

  const setThemeMode = (theme: AppConfig['general']['theme']) => {
    config.value.general.theme = theme;
    onConfigChange();
  };

  const selectThemePreset = (presetId: string) => {
    config.value.general.themePresetId = presetId;
    onConfigChange();
  };

  return {
    customPresetSummaries,
    currentThemePresetId,
    filteredBuiltinPresetCards,
    filteredCustomPresetCards,
    gallerySectionTitle,
    searchQuery,
    selectedPresetLabel,
    setThemeMode,
    selectThemePreset,
    themeOptions,
    themePresetSummaries,
    capitalizeWord,
  };
};
