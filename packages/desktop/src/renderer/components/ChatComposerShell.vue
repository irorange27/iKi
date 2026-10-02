<template>
  <div>
    <div
      class="relative border chat-input-container"
      @dragover.prevent="emit('dragover', $event)"
      @drop.prevent="handleDrop"
    >
      <div class="composer-input-region">
        <div class="composer-input-stack">
          <slot name="input-context" />
          <slot name="image-previews" />
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
            :class="{ 'is-expanded': isExpanded, 'has-expand-toggle': showExpandToggle }"
            @input="emitModelValue"
            @keydown="emit('keydown', $event)"
            @keydown.enter="emit('keydownEnter', $event)"
            @compositionstart="emit('compositionStart', $event)"
            @compositionend="emit('compositionEnd', $event)"
            @paste="handlePaste"
          />
        </div>
        <button
          v-if="showExpandToggle"
          type="button"
          class="composer-control-btn composer-expand-toggle h-7 w-7 rounded-lg flex items-center justify-center ui-text-secondary"
          :class="{ 'is-expanded': isExpanded }"
          :aria-pressed="isExpanded"
          :aria-label="expandToggleLabel"
          :title="expandToggleLabel"
          @click="toggleExpanded"
        >
          <Minimize2 v-if="isExpanded" class="h-4 w-4" />
          <Maximize2 v-else class="h-4 w-4" />
        </button>
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

      <div class="composer-toolbar">
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
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { Maximize2, Minimize2 } from 'lucide-vue-next';
import { useI18n } from '../i18n';

type ComposerTextControl = HTMLTextAreaElement;

const props = defineProps<{
  modelValue: string;
  placeholder: string;
  feedback?: string;
  setInputRef?: ((element: ComposerTextControl | null) => void) | null;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: string];
  keydown: [value: KeyboardEvent];
  keydownEnter: [value: KeyboardEvent];
  compositionStart: [value: CompositionEvent];
  compositionEnd: [value: CompositionEvent];
  dismissFeedback: [];
  dragover: [value: DragEvent];
  pasteImage: [value: { mediaType: string; url: string; filename?: string }];
  dropImages: [value: { mediaType: string; url: string; filename?: string }[]];
}>();

const { t } = useI18n();

const inputRef = ref<ComposerTextControl | null>(null);
const MIN_INPUT_HEIGHT_PX = 48;
const MAX_INPUT_HEIGHT_PX = 220;
const EXPANDED_INPUT_HEIGHT_PX = 480;
const EXPAND_TOGGLE_CHAR_THRESHOLD = 200;

const isExpanded = ref(false);
const isOverflowClamped = ref(false);

const expandedInputHeight = () => {
  const viewportCap = Math.floor(window.innerHeight * 0.55);
  return Math.min(EXPANDED_INPUT_HEIGHT_PX, Math.max(MIN_INPUT_HEIGHT_PX, viewportCap));
};

const resizeInputField = () => {
  const input = inputRef.value;
  if (!input) return;

  if (isExpanded.value) {
    input.style.height = `${expandedInputHeight()}px`;
    input.style.overflowY = 'auto';
    isOverflowClamped.value = false;
    return;
  }

  input.style.height = '0px';
  const nextHeight = Math.min(
    Math.max(input.scrollHeight, MIN_INPUT_HEIGHT_PX),
    MAX_INPUT_HEIGHT_PX
  );
  input.style.height = `${nextHeight}px`;
  isOverflowClamped.value = input.scrollHeight > MAX_INPUT_HEIGHT_PX;
  input.style.overflowY = isOverflowClamped.value ? 'auto' : 'hidden';
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

const handlePaste = (event: ClipboardEvent) => {
  const items = event.clipboardData?.items;
  if (!items) return;

  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    if (item && item.type.startsWith('image/')) {
      event.preventDefault();
      const file = item.getAsFile();
      if (!file) continue;
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === 'string') {
          emit('pasteImage', {
            mediaType: file.type,
            url: reader.result,
            filename: file.name || undefined,
          });
        }
      };
      reader.readAsDataURL(file);
    }
  }
};

const handleDrop = (event: DragEvent) => {
  const files = event.dataTransfer?.files;
  if (!files || files.length === 0) return;

  const imagePayloads: { mediaType: string; url: string; filename?: string }[] = [];
  let pending = 0;

  for (let i = 0; i < files.length; i += 1) {
    const file = files[i];
    if (file && file.type.startsWith('image/')) {
      pending += 1;
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === 'string') {
          imagePayloads.push({
            mediaType: file.type,
            url: reader.result,
            filename: file.name || undefined,
          });
        }
        pending -= 1;
        if (pending === 0 && imagePayloads.length > 0) {
          emit('dropImages', imagePayloads);
        }
      };
      reader.readAsDataURL(file);
    }
  }
};

watch(
  () => props.modelValue,
  nextValue => {
    if (nextValue.length === 0) {
      isExpanded.value = false;
      isOverflowClamped.value = false;
    }
    queueResize();
  },
  { flush: 'post' }
);

const showExpandToggle = computed(
  () =>
    isExpanded.value ||
    isOverflowClamped.value ||
    props.modelValue.length >= EXPAND_TOGGLE_CHAR_THRESHOLD
);

const expandToggleLabel = computed(() =>
  isExpanded.value ? t('chat.input.collapseComposer') : t('chat.input.expandComposer')
);

const toggleExpanded = () => {
  isExpanded.value = !isExpanded.value;
  queueResize();
  const input = inputRef.value;
  if (!input) return;
  input.focus();
  const caret = input.value.length;
  input.setSelectionRange(caret, caret);
};

const handleViewportResize = () => {
  queueResize();
};

onMounted(() => {
  queueResize();
  window.addEventListener('resize', handleViewportResize);
});

onBeforeUnmount(() => {
  window.removeEventListener('resize', handleViewportResize);
});
</script>

<style scoped>
.chat-input-container {
  display: flex;
  flex-direction: column;
  border-color: var(--chat-composer-border-color);
  border-radius: var(--surface-radius);
  background: var(--chat-composer-background);
  box-shadow: var(--chat-composer-shadow);
  backdrop-filter: var(--chat-composer-backdrop-filter);
  /* Toolbar degradation keys off the composer's own width (DSH:
     Container-Over-Viewport), so a side-by-side or narrow window reflows the
     composer smoothly instead of on viewport breakpoints. */
  container-type: inline-size;
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

.chat-input-field.is-expanded {
  max-height: none;
}

/* keeps typed text clear of the floating expand toggle in the top-right corner */
.chat-input-field.has-expand-toggle {
  padding-right: 36px;
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
  align-items: center;
  justify-content: space-between;
  gap: 8px 12px;
  padding: 6px 12px 10px;
  border-radius: 0 0 var(--surface-radius) var(--surface-radius);
  /* stays transparent so the container's composer background (a gradient in
     light themes) shows through — an opaque fill would seam against it */
  background: transparent;
}

.composer-toolbar-slot {
  display: flex;
  min-width: 0;
}

/* Both slots hug their content (no inflated flex basis): the toolbar only
   wraps when the two groups genuinely no longer fit side by side, and the
   second row starts at the left edge instead of after an elastic gap. */
.composer-toolbar-slot-left {
  flex: 0 1 auto;
}

.composer-toolbar-slot-right {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 8px;
  /* keeps the actions pinned to the right edge even when the toolbar wraps */
  justify-content: flex-end;
  margin-left: auto;
}

/* Tight container: tighten the rhythm instead of jumping layouts. */
@container (max-width: 560px) {
  .composer-input-region {
    padding: 10px 10px 6px;
  }

  .composer-toolbar {
    gap: 6px 8px;
    padding: 6px 8px 8px;
  }
}

.composer-expand-toggle {
  position: absolute;
  top: 10px;
  right: 10px;
  z-index: 1;
}

.composer-expand-toggle.is-expanded {
  border-color: rgba(var(--accent-rgb), 0.34);
  background: rgba(var(--accent-rgb), 0.12);
  color: var(--accent-color);
}

.placeholder-muted::placeholder {
  color: var(--text-muted);
}

.border-color {
  border-color: var(--border-color);
}
</style>
