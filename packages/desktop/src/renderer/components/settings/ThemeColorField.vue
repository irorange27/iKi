<template>
  <label class="theme-color-field">
    <span class="theme-color-label">{{ label }}</span>
    <span class="theme-color-hint">{{ hint }}</span>
    <div class="theme-color-input-shell">
      <input
        class="theme-color-picker"
        type="color"
        :value="pickerValue"
        @input="handleColorInput"
      />
      <input
        class="theme-color-input"
        type="text"
        :value="textValue"
        spellcheck="false"
        autocapitalize="off"
        autocomplete="off"
        @input="handleTextInput"
        @blur="handleTextBlur"
      />
    </div>
  </label>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';

import { normalizeHexColor } from '@iki/theme/color_utils';

const props = defineProps<{
  label: string;
  hint: string;
  value: string;
}>();

const emit = defineEmits<{
  (event: 'update:value', value: string): void;
}>();

const textValue = ref(props.value);

watch(
  () => props.value,
  value => {
    textValue.value = value;
  }
);

const tryNormalize = (value: string): string | null => {
  try {
    return normalizeHexColor(value);
  } catch {
    return null;
  }
};

const pickerValue = computed(() => tryNormalize(props.value) ?? '#000000');

const handleColorInput = (event: Event) => {
  const nextValue = (event.target as HTMLInputElement | null)?.value ?? props.value;
  textValue.value = nextValue;
  emit('update:value', nextValue);
};

const handleTextInput = (event: Event) => {
  const nextValue = (event.target as HTMLInputElement | null)?.value ?? '';
  textValue.value = nextValue;
  const normalized = tryNormalize(nextValue);
  if (normalized) {
    emit('update:value', normalized);
  }
};

const handleTextBlur = () => {
  textValue.value = props.value;
};
</script>

<style scoped>
.theme-color-field {
  display: block;
}

.theme-color-label {
  display: block;
  color: var(--text-primary);
  font-size: 1em;
  font-weight: 600;
}

.theme-color-hint {
  display: block;
  color: var(--text-secondary);
  font-size: 0.92em;
  margin-top: 4px;
  margin-bottom: 10px;
}

.theme-color-input-shell {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid var(--border-color);
  border-radius: 16px;
  background: color-mix(in srgb, var(--bg-secondary) 88%, transparent);
}

.theme-color-picker {
  width: 40px;
  height: 40px;
  padding: 0;
  border: none;
  background: transparent;
}

.theme-color-input {
  flex: 1;
  border: none;
  background: transparent;
  color: var(--text-primary);
  font-size: 1em;
}

.theme-color-input:focus {
  outline: none;
}
</style>
