<template>
  <div>
    <div class="relative rounded-[22px] border chat-input-container">
      <div class="composer-input-region">
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
          @keydown.enter="emit('keydownEnter', $event)"
          @compositionstart="emit('compositionStart', $event)"
          @compositionend="emit('compositionEnd', $event)"
        />
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
    <p v-if="props.feedback" class="composer-feedback" role="alert" aria-live="assertive">
      {{ props.feedback }}
    </p>
  </div>
</template>

<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from 'vue';

type ComposerTextControl = HTMLTextAreaElement;

const props = defineProps<{
  modelValue: string;
  placeholder: string;
  feedback?: string;
  setInputRef?: ((element: ComposerTextControl | null) => void) | null;
}>();

const emit = defineEmits<{
  (event: 'update:modelValue', value: string): void;
  (event: 'keydownEnter', value: KeyboardEvent): void;
  (event: 'compositionStart', value: CompositionEvent): void;
  (event: 'compositionEnd', value: CompositionEvent): void;
}>();

const inputRef = ref<ComposerTextControl | null>(null);
const MIN_INPUT_HEIGHT_PX = 68;
const MAX_INPUT_HEIGHT_PX = 220;

const resizeInputField = () => {
  const input = inputRef.value;
  if (!input) return;
  input.style.height = '0px';
  const nextHeight = Math.min(Math.max(input.scrollHeight, MIN_INPUT_HEIGHT_PX), MAX_INPUT_HEIGHT_PX);
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
  display: flex;
  min-width: 0;
  align-items: flex-end;
  padding: 18px 16px 10px;
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
  display: block;
  width: 100%;
  min-width: 0;
  min-height: 68px;
  max-height: 220px;
  resize: none;
  overflow-y: hidden;
  border: 0;
  background: transparent;
  padding: 0;
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
  gap: 10px 16px;
  padding: 10px 12px 12px;
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
