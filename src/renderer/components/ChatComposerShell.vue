<template>
  <div>
    <div class="relative rounded-[22px] border chat-input-container">
      <div class="composer-input-region">
        <div class="composer-input-stack">
          <slot name="input-context" />
          <textarea
            rows="1"
            spellcheck="true"
            enterkeyhint="send"
            autocapitalize="sentences"
            autocomplete="off"
            autocorrect="on"
            data-gramm="false"
            :ref="assignInputRef"
            :value="props.modelValue"
            :placeholder="props.placeholder"
            class="chat-input-field ui-text-primary placeholder-muted focus:outline-none"
            @input="emitModelValue"
            @keydown="emit('keydown', $event)"
            @keydown.enter="emit('keydownEnter', $event)"
            @compositionstart="emit('compositionStart', $event)"
            @compositionend="emit('compositionEnd', $event)"
          />
        </div>
        <slot name="input-overlay" />
      </div>

      <div
        v-if="props.feedback"
        class="composer-feedback border-t border-color"
        role="alert"
        aria-live="assertive"
      >
        <p class="composer-feedback-message">
          {{ props.feedback }}
        </p>
        <button
          type="button"
          class="composer-feedback-dismiss"
          :aria-label="t('common.close')"
          @click="emit('dismissFeedback')"
        >
          <span aria-hidden="true">×</span>
        </button>
      </div>

      <div class="composer-toolbar border-t border-color">
        <div class="composer-toolbar-slot composer-toolbar-slot-left">
          <slot name="toolbar-left" />
        </div>
        <div class="composer-toolbar-slot composer-toolbar-slot-right">
          <slot name="toolbar-right" />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from 'vue';
import { useI18n } from '../i18n';

type ComposerTextControl = HTMLTextAreaElement;

const props = defineProps<{
  modelValue: string;
  placeholder: string;
  feedback?: string;
  setInputRef?: ((element: ComposerTextControl | null) => void) | null;
}>();

const emit = defineEmits<{
  (event: 'update:modelValue', value: string): void;
  (event: 'keydown', value: KeyboardEvent): void;
  (event: 'keydownEnter', value: KeyboardEvent): void;
  (event: 'compositionStart', value: CompositionEvent): void;
  (event: 'compositionEnd', value: CompositionEvent): void;
  (event: 'dismissFeedback'): void;
}>();

const { t } = useI18n();

const inputRef = ref<ComposerTextControl | null>(null);
const MIN_INPUT_HEIGHT_PX = 48;
const MAX_INPUT_HEIGHT_PX = 220;

const resizeInputField = () => {
  const input = inputRef.value;
  if (!input) return;
  input.style.height = '0px';
  const nextHeight = Math.min(
    Math.max(input.scrollHeight, MIN_INPUT_HEIGHT_PX),
    MAX_INPUT_HEIGHT_PX
  );
  input.style.height = `${nextHeight}px`;
  input.style.overflowY = input.scrollHeight > MAX_INPUT_HEIGHT_PX ? 'auto' : 'hidden';
};

const queueResize = () => {
  void nextTick(() => {
    resizeInputField();
  });
};

const assignInputRef = (element: Element | null) => {
  inputRef.value = element instanceof HTMLTextAreaElement ? element : null;
  props.setInputRef?.(inputRef.value);
  queueResize();
};

const emitModelValue = (event: Event) => {
  const target = event.target;
  emit('update:modelValue', target instanceof HTMLTextAreaElement ? target.value : '');
  queueResize();
};

watch(
  () => props.modelValue,
  () => {
    queueResize();
  },
  { flush: 'post' }
);

onMounted(() => {
  queueResize();
});
</script>

<style scoped>
.chat-input-container {
  display: flex;
  flex-direction: column;
  border-color: var(--chat-composer-border-color);
  border-radius: 12px;
  background: var(--chat-composer-background);
  box-shadow: var(--chat-composer-shadow);
  backdrop-filter: var(--chat-composer-backdrop-filter);
}

.composer-input-region {
  position: relative;
  display: flex;
  min-width: 0;
  align-items: stretch;
  padding: 14px 14px 8px;
}

.composer-input-stack {
  display: flex;
  min-width: 0;
  width: 100%;
  flex: 1 1 auto;
  flex-wrap: wrap;
  align-items: flex-start;
  align-content: flex-start;
  gap: 6px;
}

.composer-feedback {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 12px;
  background: color-mix(in srgb, var(--danger-color) 7%, var(--chat-composer-background));
  color: var(--danger-color);
  font-size: 12px;
  line-height: 1.45;
}

.composer-feedback-message {
  flex: 1 1 auto;
  min-width: 0;
  margin: 0;
}

.composer-feedback-dismiss {
  flex: 0 0 auto;
  width: 24px;
  height: 24px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: inherit;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  line-height: 1;
  opacity: 0.72;
  transition:
    background-color 140ms ease,
    opacity 140ms ease;
}

.composer-feedback-dismiss:hover {
  opacity: 1;
  background: color-mix(in srgb, var(--danger-color) 12%, transparent);
}

.composer-feedback-dismiss:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--danger-color) 45%, transparent);
  outline-offset: 2px;
  opacity: 1;
}

.chat-input-field {
  display: block;
  width: 100%;
  min-width: 120px;
  flex: 999 1 140px;
  min-height: 36px;
  max-height: 220px;
  resize: none;
  overflow-y: hidden;
  border: 0;
  background: transparent;
  padding: 2px 0 0;
  line-height: 1.6;
  font-size: 15px;
  box-sizing: border-box;
  overflow-wrap: anywhere;
}

.chat-input-field::-webkit-scrollbar {
  width: 8px;
}

.chat-input-field::-webkit-scrollbar-thumb {
  border-radius: 999px;
  background: color-mix(in srgb, var(--text-muted) 34%, transparent);
}

.composer-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: 8px 14px;
  padding: 8px 12px 10px;
  border-radius: 0 0 12px 12px;
  border-top-color: var(--chat-composer-toolbar-border-color);
  background: var(--chat-composer-toolbar-background);
}

.composer-toolbar-slot {
  display: flex;
  min-width: 0;
}

.composer-toolbar-slot-left {
  flex: 1 1 320px;
}

.composer-toolbar-slot-right {
  flex: 0 1 auto;
  margin-left: auto;
}

.placeholder-muted::placeholder {
  color: var(--text-muted);
}

.border-color {
  border-color: var(--border-color);
}
</style>
