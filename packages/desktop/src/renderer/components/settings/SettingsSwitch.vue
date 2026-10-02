<template>
  <div class="settings-switch-row" :class="{ 'settings-switch-row--disabled': disabled }">
    <div class="settings-switch-row-copy">
      <span class="settings-switch-row-title">{{ title }}</span>
      <span v-if="description" class="settings-switch-row-description">{{ description }}</span>
    </div>
    <button
      type="button"
      role="switch"
      class="settings-switch"
      :class="{ 'settings-switch--on': modelValue }"
      :disabled="disabled"
      :aria-checked="modelValue ? 'true' : 'false'"
      :aria-label="ariaLabel ?? title"
      @click="toggle"
    >
      <span class="settings-switch-thumb" />
    </button>
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{
  modelValue: boolean;
  title: string;
  description?: string;
  disabled?: boolean;
  ariaLabel?: string;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
}>();

const toggle = () => {
  emit('update:modelValue', !props.modelValue);
};
</script>

<style scoped>
/* One settings row: copy on the left, switch on the right. The row owns its
   trailing hairline (the group strips the last one). */
.settings-switch-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 0;
  border-bottom: 1px solid color-mix(in srgb, var(--border-color) 45%, transparent);
}

.settings-switch-row--disabled {
  opacity: 0.55;
}

.settings-switch-row-copy {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
}

.settings-switch-row-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  line-height: 18px;
  color: var(--text-primary);
}

.settings-switch-row-description {
  overflow: hidden;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  font-size: 12px;
  line-height: 16px;
  color: var(--text-muted);
}

.settings-switch {
  position: relative;
  flex: none;
  width: 36px;
  height: 20px;
  border: 1px solid var(--border-color);
  border-radius: 999px;
  background: var(--bg-tertiary);
  cursor: pointer;
  transition:
    background-color 0.15s,
    border-color 0.15s;
}

.settings-switch-thumb {
  position: absolute;
  top: 1px;
  left: 1px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--switch-thumb-bg);
  box-shadow: var(--switch-thumb-shadow);
  transition: transform 0.15s ease;
}

.settings-switch--on {
  background: var(--accent-color);
  border-color: var(--accent-color);
}

.settings-switch--on .settings-switch-thumb {
  transform: translateX(16px);
}

.settings-switch:disabled {
  cursor: default;
  opacity: 0.55;
}

.settings-switch:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--accent-color) 45%, transparent);
  outline-offset: 2px;
}
</style>
