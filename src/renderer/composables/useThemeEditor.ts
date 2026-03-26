import { computed, reactive, type ComputedRef, type Ref } from 'vue';

import { DEFAULT_THEME_PRESET_ID, THEME_QUICK_STARTS } from '../../shared/theme/registry';
import { translate } from '../i18n';
import {
  applySimpleThemeSeed,
  buildThemePresetVariant,
  createAdvancedThemeSeedFromDocument,
  createSimpleThemeSeedFromDocument,
  createThemePreviewDocument,
  createThemePreviewPalette,
  createThemePreviewStyle,
} from '../../shared/theme/theme_editor';
import { cloneBase46ThemePresetInput, createThemePresetId } from '../../shared/theme/theme_creator';
import type {
  AdvancedThemeSeed,
  Base46ThemePresetInput,
  SimpleThemeSeed,
  ThemePresetSummary,
  ThemeVariant,
} from '../../shared/theme/types';
import type { AppConfig } from '../../shared/types/config';

export type ThemeEditorMode = 'simple' | 'advanced';

export type ThemeEditorState = {
  open: boolean;
  editingPresetId: string | null;
  mode: ThemeEditorMode;
  type: ThemeVariant;
  label: string;
  quickStartId: string | null;
  simple: SimpleThemeSeed;
  advanced: AdvancedThemeSeed;
  error: string;
};

const quickStarts = THEME_QUICK_STARTS;

const createInitialSimpleSeed = (): SimpleThemeSeed => ({ ...quickStarts[0].dark });
const createInitialAdvancedSeed = (): AdvancedThemeSeed => applySimpleThemeSeed(createInitialSimpleSeed(), 'dark').advanced;

const resolveDeleteConfirmation = (): boolean => {
  if (
    typeof window !== 'undefined' &&
    typeof window.confirm === 'function' &&
    !window.confirm(translate('settings.theme.error.deleteConfirm'))
  ) {
    return false;
  }

  return true;
};

export const useThemeEditor = ({
  config,
  themePresetSummaries,
  onConfigChange,
}: {
  config: Ref<AppConfig>;
  themePresetSummaries: ComputedRef<ThemePresetSummary[]>;
  onConfigChange: () => void;
}) => {
  const themeVariantOptions = computed<Array<{ value: ThemeVariant; label: string }>>(() => [
    { value: 'dark', label: translate('common.dark') },
    { value: 'light', label: translate('common.light') },
  ]);

  const editor = reactive<ThemeEditorState>({
    open: false,
    editingPresetId: null,
    mode: 'simple',
    type: 'dark',
    label: '',
    quickStartId: quickStarts[0]?.id ?? null,
    simple: createInitialSimpleSeed(),
    advanced: createInitialAdvancedSeed(),
    error: '',
  });

  const applyQuickStart = (quickStartId: string) => {
    const preset = quickStarts.find(item => item.id === quickStartId);
    if (!preset) return;

    const nextSeed = editor.type === 'light' ? preset.light : preset.dark;
    const nextState = applySimpleThemeSeed(nextSeed, editor.type);
    editor.quickStartId = quickStartId;
    editor.simple = nextState.simple;
    editor.advanced = nextState.advanced;
  };

  const resetEditor = () => {
    editor.editingPresetId = null;
    editor.mode = 'simple';
    editor.type = config.value.general.theme === 'light' ? 'light' : 'dark';
    editor.label = '';
    editor.quickStartId = quickStarts[0]?.id ?? null;
    applyQuickStart(editor.quickStartId ?? quickStarts[0]?.id ?? '');
    editor.error = '';
  };

  const openCreateThemeModal = () => {
    resetEditor();
    editor.label = translate('settings.theme.modal.displayNamePlaceholder');
    editor.open = true;
  };

  const loadPresetVariantIntoEditor = (preset: Base46ThemePresetInput, variant: ThemeVariant) => {
    const sourceDocument =
      (variant === 'light' ? preset.light : preset.dark) ?? preset.dark ?? preset.light;

    if (!sourceDocument) {
      applyQuickStart(quickStarts[0]?.id ?? '');
      return;
    }

    editor.simple = createSimpleThemeSeedFromDocument(sourceDocument);
    editor.advanced = createAdvancedThemeSeedFromDocument(sourceDocument);
    editor.quickStartId = null;
  };

  const openEditThemeModal = (presetId: string) => {
    const preset = config.value.themes.base46Presets[presetId];
    if (!preset) return;

    editor.editingPresetId = presetId;
    editor.open = true;
    editor.mode = 'advanced';
    editor.type =
      config.value.general.theme === 'light'
        ? preset.light
          ? 'light'
          : 'dark'
        : preset.dark
          ? 'dark'
          : 'light';
    editor.label = preset.label;
    editor.error = '';
    loadPresetVariantIntoEditor(cloneBase46ThemePresetInput(preset), editor.type);
  };

  const closeEditor = () => {
    editor.open = false;
    editor.error = '';
  };

  const setEditorMode = (mode: 'simple' | 'advanced') => {
    if (mode === editor.mode) return;

    editor.mode = mode;
    if (mode === 'advanced') {
      editor.advanced = applySimpleThemeSeed(editor.simple, editor.type).advanced;
      return;
    }

    editor.simple = {
      background: editor.advanced.background,
      text: editor.advanced.text,
      accent: editor.advanced.accent,
      secondary: editor.advanced.secondary,
    };
  };

  const setEditorType = (variant: ThemeVariant) => {
    if (variant === editor.type) return;

    editor.type = variant;
    if (editor.quickStartId) {
      applyQuickStart(editor.quickStartId);
      return;
    }

    if (editor.editingPresetId) {
      const preset = config.value.themes.base46Presets[editor.editingPresetId];
      if (preset) {
        loadPresetVariantIntoEditor(preset, variant);
        return;
      }
    }

    editor.advanced = applySimpleThemeSeed(editor.simple, variant).advanced;
  };

  const updateSimpleColor = (key: keyof SimpleThemeSeed, next: string) => {
    const nextSimple = {
      ...editor.simple,
      [key]: next,
    };

    editor.simple = nextSimple;
    editor.advanced = applySimpleThemeSeed(nextSimple, editor.type).advanced;
    editor.quickStartId = null;
    editor.error = '';
  };

  const updateAdvancedColor = (key: keyof AdvancedThemeSeed, next: string) => {
    editor.advanced = {
      ...editor.advanced,
      [key]: next,
    };
    editor.quickStartId = null;
    editor.error = '';
  };

  const previewDocument = computed(() =>
    createThemePreviewDocument({
      label: editor.label,
      mode: editor.mode,
      type: editor.type,
      simpleSeed: editor.simple,
      advancedSeed: editor.advanced,
    })
  );
  const previewPalette = computed(() => createThemePreviewPalette(previewDocument.value));
  const previewStyle = computed<Record<string, string>>(() =>
    createThemePreviewStyle(previewPalette.value)
  );

  const saveTheme = () => {
    editor.error = '';

    try {
      const label = editor.label.trim();
      if (!label) {
        throw new Error(translate('settings.theme.error.displayNameRequired'));
      }

      const currentPresets = config.value.themes.base46Presets;
      const nextPresetId =
        editor.editingPresetId ??
        createThemePresetId(label, [
          ...themePresetSummaries.value.map(preset => preset.id),
          ...Object.keys(currentPresets),
        ]);
      const existingPreset = currentPresets[nextPresetId];
      const nextPreset = buildThemePresetVariant({
        label,
        existingPreset,
        type: editor.type,
        document: previewDocument.value,
      });

      config.value.themes.base46Presets[nextPresetId] = cloneBase46ThemePresetInput(nextPreset);
      config.value.general.themePresetId = nextPresetId;
      onConfigChange();
      closeEditor();
    } catch (error) {
      editor.error =
        error instanceof Error ? error.message : translate('settings.theme.error.saveFailed');
    }
  };

  const deleteCustomTheme = (presetId: string) => {
    if (!resolveDeleteConfirmation()) return;

    delete config.value.themes.base46Presets[presetId];
    if (config.value.general.themePresetId === presetId) {
      config.value.general.themePresetId = DEFAULT_THEME_PRESET_ID;
    }
    onConfigChange();
  };

  return {
    closeEditor,
    deleteCustomTheme,
    editor,
    openCreateThemeModal,
    openEditThemeModal,
    previewStyle,
    quickStarts,
    saveTheme,
    setEditorMode,
    setEditorType,
    themeVariantOptions,
    updateAdvancedColor,
    updateSimpleColor,
    applyQuickStart,
  };
};
