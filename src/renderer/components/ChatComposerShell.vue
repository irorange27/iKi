<template>
  <div>
    <div class="relative rounded-[22px] border chat-input-container">
      <input
        :ref="assignInputRef"
        :value="props.modelValue"
        type="text"
        :placeholder="props.placeholder"
        class="chat-input-field ui-text-primary w-full border-0 bg-transparent px-4 py-6 placeholder-muted focus:outline-none"
        @input="emitModelValue"
        @keydown.enter="emit('keydownEnter', $event)"
        @compositionstart="emit('compositionStart', $event)"
        @compositionend="emit('compositionEnd', $event)"
      />

      <div class="composer-toolbar flex items-center justify-between border-t border-color px-3 py-2">
        <slot name="toolbar-left" />
        <slot name="toolbar-right" />
      </div>
    </div>
    <p v-if="props.feedback" class="composer-feedback" role="alert" aria-live="assertive">
      {{ props.feedback }}
    </p>
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{
  modelValue: string;
  placeholder: string;
  feedback?: string;
  setInputRef?: ((element: HTMLInputElement | null) => void) | null;
}>();

const emit = defineEmits<{
  (event: 'update:modelValue', value: string): void;
  (event: 'keydownEnter', value: KeyboardEvent): void;
  (event: 'compositionStart', value: CompositionEvent): void;
  (event: 'compositionEnd', value: CompositionEvent): void;
}>();

const assignInputRef = (element: Element | null) => {
  props.setInputRef?.(element instanceof HTMLInputElement ? element : null);
};

const emitModelValue = (event: Event) => {
  const target = event.target;
  emit('update:modelValue', target instanceof HTMLInputElement ? target.value : '');
};
</script>

<style scoped>
.chat-input-container {
  border-color: var(--chat-composer-border-color);
  border-radius: 12px;
  background: var(--chat-composer-background);
  box-shadow: var(--chat-composer-shadow);
  backdrop-filter: var(--chat-composer-backdrop-filter);
}

.composer-feedback {
  margin-top: 10px;
  border: 1px solid color-mix(in srgb, var(--danger-color) 34%, var(--border-color));
  border-radius: 12px;
  padding: 10px 12px;
  background: color-mix(in srgb, var(--danger-color) 9%, var(--bg-secondary));
  color: var(--danger-color);
  font-size: 12px;
  line-height: 1.45;
}

.chat-input-field {
  padding-top: 28px;
  padding-bottom: 28px;
  font-size: 15px;
}

.composer-toolbar {
  padding: 10px 12px 12px;
  border-top-color: var(--chat-composer-toolbar-border-color);
  background: var(--chat-composer-toolbar-background);
}

.placeholder-muted::placeholder {
  color: var(--text-muted);
}

.border-color {
  border-color: var(--border-color);
}
</style>
