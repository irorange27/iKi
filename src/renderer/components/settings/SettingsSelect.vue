<template>
  <div
    ref="rootRef"
    class="settings-select"
    :class="{
      'settings-select-open': isOpen,
      'settings-select-disabled': disabled,
    }"
  >
    <button
      ref="triggerRef"
      type="button"
      class="settings-select-trigger"
      :disabled="disabled"
      :aria-expanded="isOpen ? 'true' : 'false'"
      aria-haspopup="listbox"
      :aria-label="ariaLabel"
      @click="toggleOpen"
      @keydown="handleTriggerKeydown"
    >
      <span class="settings-select-trigger-copy">
        <span
          class="settings-select-trigger-value"
          :class="{ 'settings-select-trigger-placeholder': !selectedOption }"
        >
          {{ selectedOption?.label || placeholder }}
        </span>
        <span v-if="selectedOption?.description" class="settings-select-trigger-meta">
          {{ selectedOption.description }}
        </span>
      </span>

      <svg
        class="settings-select-chevron"
        :class="{ 'settings-select-chevron-open': isOpen }"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        aria-hidden="true"
      >
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          d="M19 9l-7 7-7-7"
        />
      </svg>
    </button>

    <div v-if="isOpen" class="settings-select-panel" role="listbox" :aria-label="ariaLabel">
      <div v-if="flatOptions.length === 0" class="settings-select-empty">
        {{ emptyText }}
      </div>
      <div v-else class="settings-select-options">
        <div
          v-for="group in resolvedGroups"
          :key="group.key"
          class="settings-select-group"
          :class="{ 'settings-select-group-labeled': !!group.label }"
        >
          <div v-if="group.label" class="settings-select-group-label">
            {{ group.label }}
          </div>

          <button
            v-for="option in group.options"
            :id="buildOptionId(option.flatIndex)"
            :key="option.key"
            :ref="element => setOptionRef(element as HTMLButtonElement | null, option.flatIndex)"
            type="button"
            role="option"
            class="settings-select-option"
            :class="{
              'settings-select-option-active': highlightedIndex === option.flatIndex,
              'settings-select-option-selected': option.value === modelValue,
              'settings-select-option-disabled': option.disabled,
            }"
            :aria-selected="option.value === modelValue ? 'true' : 'false'"
            :disabled="option.disabled"
            @click="selectOption(option.value)"
            @mouseenter="highlightIndex(option.flatIndex)"
            @focus="highlightIndex(option.flatIndex)"
            @keydown="handleOptionKeydown($event, option.flatIndex)"
          >
            <span class="settings-select-option-copy">
              <span class="settings-select-option-label">{{ option.label }}</span>
              <span v-if="option.description" class="settings-select-option-description">
                {{ option.description }}
              </span>
            </span>

            <span class="settings-select-option-check" aria-hidden="true">
              <svg
                v-if="option.value === modelValue"
                class="settings-select-option-check-icon"
                viewBox="0 0 20 20"
                fill="currentColor"
              >
                <path
                  fill-rule="evenodd"
                  d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                  clip-rule="evenodd"
                />
              </svg>
            </span>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';

type SettingsSelectOption = {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
};

type SettingsSelectOptionGroup = {
  label: string;
  options: SettingsSelectOption[];
};

type SettingsSelectEntry = SettingsSelectOption | SettingsSelectOptionGroup;

type ResolvedSettingsSelectOption = SettingsSelectOption & {
  key: string;
  flatIndex: number;
};

type ResolvedSettingsSelectGroup = {
  key: string;
  label: string | null;
  options: ResolvedSettingsSelectOption[];
};

const props = withDefaults(
  defineProps<{
    modelValue: string;
    options: SettingsSelectEntry[];
    placeholder?: string;
    emptyText?: string;
    disabled?: boolean;
    ariaLabel?: string;
  }>(),
  {
    placeholder: 'Select an option',
    emptyText: 'No options available.',
    disabled: false,
    ariaLabel: 'Select an option',
  }
);

const emit = defineEmits<{
  (event: 'update:modelValue', value: string): void;
  (event: 'change', value: string): void;
}>();

const rootRef = ref<HTMLElement | null>(null);
const triggerRef = ref<HTMLButtonElement | null>(null);
const optionRefs = ref<Array<HTMLButtonElement | null>>([]);
const isOpen = ref(false);
const highlightedIndex = ref(-1);
const instanceId = `settings-select-${Math.random().toString(36).slice(2, 10)}`;

const isOptionGroup = (entry: SettingsSelectEntry): entry is SettingsSelectOptionGroup =>
  Array.isArray((entry as SettingsSelectOptionGroup).options);

const resolvedGroups = computed<ResolvedSettingsSelectGroup[]>(() => {
  const groups: ResolvedSettingsSelectGroup[] = [];
  let pendingUngrouped: ResolvedSettingsSelectOption[] = [];
  let looseGroupCount = 0;
  let flatIndex = 0;

  const flushPendingUngrouped = () => {
    if (pendingUngrouped.length === 0) return;
    groups.push({
      key: `ungrouped-${looseGroupCount}`,
      label: null,
      options: pendingUngrouped,
    });
    looseGroupCount += 1;
    pendingUngrouped = [];
  };

  props.options.forEach((entry, entryIndex) => {
    if (isOptionGroup(entry)) {
      flushPendingUngrouped();
      const options = entry.options.map(option => ({
        ...option,
        key: `group-${entryIndex}-${option.value}-${flatIndex}`,
        flatIndex: flatIndex++,
      }));
      if (options.length > 0) {
        groups.push({
          key: `group-${entryIndex}-${entry.label}`,
          label: entry.label,
          options,
        });
      }
      return;
    }

    pendingUngrouped.push({
      ...entry,
      key: `option-${entry.value}-${flatIndex}`,
      flatIndex: flatIndex++,
    });
  });

  flushPendingUngrouped();
  return groups;
});

const flatOptions = computed(() => resolvedGroups.value.flatMap(group => group.options));

const selectedIndex = computed(() =>
  flatOptions.value.findIndex(option => option.value === props.modelValue)
);
const selectedOption = computed(() =>
  selectedIndex.value >= 0 ? flatOptions.value[selectedIndex.value] ?? null : null
);
const enabledOptionIndexes = computed(() =>
  flatOptions.value.reduce<number[]>((indexes, option, index) => {
    if (!option.disabled) indexes.push(index);
    return indexes;
  }, [])
);

const buildOptionId = (index: number) => `${instanceId}-option-${index}`;

const setOptionRef = (element: HTMLButtonElement | null, index: number) => {
  optionRefs.value[index] = element;
};

const getDefaultOpenIndex = (): number => {
  if (
    selectedIndex.value >= 0 &&
    selectedIndex.value < flatOptions.value.length &&
    !flatOptions.value[selectedIndex.value]?.disabled
  ) {
    return selectedIndex.value;
  }
  return enabledOptionIndexes.value[0] ?? -1;
};

const focusOption = async (index: number) => {
  if (index < 0) return;
  highlightedIndex.value = index;
  await nextTick();
  optionRefs.value[index]?.focus();
  optionRefs.value[index]?.scrollIntoView?.({ block: 'nearest' });
};

const openSelect = async (preferredIndex?: number) => {
  if (props.disabled) return;
  isOpen.value = true;
  const nextIndex =
    preferredIndex !== undefined &&
    preferredIndex >= 0 &&
    preferredIndex < flatOptions.value.length &&
    !flatOptions.value[preferredIndex]?.disabled
      ? preferredIndex
      : getDefaultOpenIndex();
  if (nextIndex >= 0) {
    await focusOption(nextIndex);
  }
};

const closeSelect = (restoreFocus = false) => {
  if (!isOpen.value) return;
  isOpen.value = false;
  highlightedIndex.value = -1;
  if (restoreFocus) {
    void nextTick(() => {
      triggerRef.value?.focus();
    });
  }
};

const toggleOpen = () => {
  if (props.disabled) return;
  if (isOpen.value) {
    closeSelect();
    return;
  }
  void openSelect();
};

const selectOption = (value: string) => {
  const option = flatOptions.value.find(candidate => candidate.value === value);
  if (!option || option.disabled) return;
  if (value !== props.modelValue) {
    emit('update:modelValue', value);
    emit('change', value);
  }
  closeSelect(true);
};

const highlightIndex = (index: number) => {
  if (flatOptions.value[index]?.disabled) return;
  highlightedIndex.value = index;
};

const moveHighlight = (delta: 1 | -1) => {
  const enabledIndexes = enabledOptionIndexes.value;
  if (enabledIndexes.length === 0) return;

  const currentPosition = enabledIndexes.indexOf(highlightedIndex.value);
  const startPosition = currentPosition >= 0 ? currentPosition : 0;
  const nextPosition =
    (startPosition + delta + enabledIndexes.length) % enabledIndexes.length;
  void focusOption(enabledIndexes[nextPosition] ?? -1);
};

const focusBoundaryOption = (position: 'start' | 'end') => {
  const enabledIndexes = enabledOptionIndexes.value;
  if (enabledIndexes.length === 0) return;
  void focusOption(
    position === 'start' ? (enabledIndexes[0] ?? -1) : (enabledIndexes.at(-1) ?? -1)
  );
};

const handleTriggerKeydown = (event: KeyboardEvent) => {
  switch (event.key) {
    case 'ArrowDown':
      event.preventDefault();
      void openSelect(getDefaultOpenIndex());
      break;
    case 'ArrowUp':
      event.preventDefault();
      void openSelect(enabledOptionIndexes.value.at(-1));
      break;
    case 'Enter':
    case ' ':
      event.preventDefault();
      toggleOpen();
      break;
    case 'Escape':
      if (!isOpen.value) return;
      event.preventDefault();
      closeSelect(true);
      break;
    default:
      break;
  }
};

const handleOptionKeydown = (event: KeyboardEvent, index: number) => {
  switch (event.key) {
    case 'ArrowDown':
      event.preventDefault();
      moveHighlight(1);
      break;
    case 'ArrowUp':
      event.preventDefault();
      moveHighlight(-1);
      break;
    case 'Home':
      event.preventDefault();
      focusBoundaryOption('start');
      break;
    case 'End':
      event.preventDefault();
      focusBoundaryOption('end');
      break;
    case 'Enter':
    case ' ':
      event.preventDefault();
      selectOption(props.options[index]?.value ?? '');
      break;
    case 'Escape':
      event.preventDefault();
      closeSelect(true);
      break;
    case 'Tab':
      closeSelect();
      break;
    default:
      break;
  }
};

const handleDocumentMouseDown = (event: MouseEvent) => {
  if (!isOpen.value) return;
  const target = event.target;
  if (!(target instanceof Node)) return;
  if (rootRef.value?.contains(target)) return;
  closeSelect();
};

watch(flatOptions, nextOptions => {
  if (nextOptions.length === 0) {
    closeSelect();
    return;
  }
  if (highlightedIndex.value >= nextOptions.length) {
    highlightedIndex.value = getDefaultOpenIndex();
  }
});

watch(
  () => props.options,
  nextOptions => {
    if (nextOptions.length === 0) {
      closeSelect();
    }
  }
);

watch(
  () => props.disabled,
  disabled => {
    if (disabled) {
      closeSelect();
    }
  }
);

onMounted(() => {
  document.addEventListener('mousedown', handleDocumentMouseDown);
});

onUnmounted(() => {
  document.removeEventListener('mousedown', handleDocumentMouseDown);
});
</script>

<style scoped>
.settings-select {
  position: relative;
  width: 100%;
  margin-top: 6px;
}

.settings-select-trigger {
  display: flex;
  width: 100%;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border: 1px solid var(--border-color);
  border-radius: var(--control-radius-sm);
  background: var(--bg-secondary);
  color: var(--text-primary);
  padding: 10px 12px;
  font-size: var(--font-size);
  line-height: 1.35;
  text-align: left;
  transition:
    border-color 0.2s ease,
    background-color 0.2s ease,
    box-shadow 0.2s ease,
    color 0.2s ease,
    opacity 0.2s ease;
  appearance: none;
  -webkit-appearance: none;
}

.settings-select-trigger:hover:not(:disabled) {
  border-color: color-mix(in srgb, var(--accent-color) 28%, var(--border-color));
  background: color-mix(in srgb, var(--bg-secondary) 88%, var(--bg-primary));
}

.settings-select-trigger:focus-visible {
  outline: none;
  border-color: var(--accent-color);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent-color) 32%, transparent);
}

.settings-select-disabled .settings-select-trigger {
  cursor: not-allowed;
  opacity: 0.65;
}

.settings-select-open .settings-select-trigger {
  border-color: var(--accent-color);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent-color) 32%, transparent);
}

.settings-select-trigger-copy {
  display: flex;
  min-width: 0;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 2px;
}

.settings-select-trigger-value {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.settings-select-trigger-placeholder {
  color: var(--text-secondary);
}

.settings-select-trigger-meta {
  font-size: 11px;
  color: var(--text-muted);
}

.settings-select-chevron {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  color: var(--text-secondary);
  transition:
    transform 0.18s ease,
    color 0.18s ease;
}

.settings-select-chevron-open {
  transform: rotate(180deg);
  color: var(--accent-color);
}

.settings-select-panel {
  position: absolute;
  top: calc(100% + 8px);
  left: 0;
  z-index: 50;
  width: 100%;
  min-width: 100%;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--border-color) 88%, transparent);
  border-radius: 14px;
  background: color-mix(in srgb, var(--bg-primary) 94%, var(--bg-secondary));
  box-shadow:
    0 22px 48px rgba(0, 0, 0, 0.2),
    0 10px 20px rgba(0, 0, 0, 0.12);
  backdrop-filter: blur(18px);
}

.settings-select-empty {
  padding: 16px;
  color: var(--text-muted);
  font-size: 13px;
  text-align: center;
}

.settings-select-options {
  display: flex;
  max-height: 260px;
  flex-direction: column;
  overflow-y: auto;
  padding: 8px;
}

.settings-select-group + .settings-select-group {
  margin-top: 6px;
  padding-top: 6px;
  border-top: 1px solid color-mix(in srgb, var(--border-color) 78%, transparent);
}

.settings-select-group-label {
  padding: 2px 12px 6px;
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.02em;
}

.settings-select-option {
  display: flex;
  width: 100%;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border: 1px solid transparent;
  border-radius: 10px;
  background: transparent;
  padding: 10px 12px;
  color: var(--text-primary);
  text-align: left;
  transition:
    border-color 0.15s ease,
    background-color 0.15s ease,
    color 0.15s ease,
    opacity 0.15s ease;
}

.settings-select-option:hover:not(:disabled),
.settings-select-option-active {
  border-color: color-mix(in srgb, var(--accent-color) 18%, transparent);
  background: color-mix(in srgb, var(--accent-color) 8%, var(--bg-secondary));
}

.settings-select-option-selected {
  border-color: color-mix(in srgb, var(--accent-color) 34%, transparent);
  background: color-mix(in srgb, var(--accent-color) 13%, var(--bg-primary));
}

.settings-select-option:focus-visible {
  outline: none;
  border-color: color-mix(in srgb, var(--accent-color) 28%, transparent);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent-color) 24%, transparent);
}

.settings-select-option-disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.settings-select-option-copy {
  display: flex;
  min-width: 0;
  flex: 1 1 auto;
  flex-direction: column;
}

.settings-select-option-label {
  font-size: 14px;
  font-weight: 600;
}

.settings-select-option-description {
  margin-top: 2px;
  font-size: 11px;
  line-height: 1.4;
  color: var(--text-secondary);
}

.settings-select-option-check {
  display: inline-flex;
  width: 18px;
  height: 18px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border: 1px solid color-mix(in srgb, var(--border-color) 88%, transparent);
  border-radius: 999px;
  background: color-mix(in srgb, var(--bg-secondary) 82%, transparent);
  color: var(--accent-contrast);
}

.settings-select-option-selected .settings-select-option-check {
  border-color: var(--accent-color);
  background: var(--accent-color);
}

.settings-select-option-check-icon {
  width: 11px;
  height: 11px;
}
</style>
