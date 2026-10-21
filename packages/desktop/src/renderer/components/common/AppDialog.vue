<template>
  <FocusScope
    trapped
    loop
    :as-child="true"
    @mount-auto-focus="onMountAutoFocus"
  >
    <div class="app-dialog-overlay" :class="overlayClass" @mousedown.self="onOverlayMouseDown">
      <div
        ref="dialogRef"
        class="app-dialog"
        :class="dialogClass"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="titleId"
        :aria-describedby="description ? descriptionId : undefined"
        @keydown.esc.stop.prevent="emit('close')"
      >
        <h2 :id="titleId" class="app-dialog-sr-title">{{ title }}</h2>
        <p v-if="description" :id="descriptionId" class="sr-only">{{ description }}</p>
        <slot />
      </div>
    </div>
  </FocusScope>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { FocusScope } from 'reka-ui';

// One owner for what none of the three hand-rolled modals had: a focus trap, a
// labelled dialog role, Escape-to-close and a return path for focus. The trap
// itself is reka-ui's FocusScope (already the project's focus primitive, via
// ConfirmDialog) rather than a fourth implementation — DesktopDialogContent is
// deliberately not used because its modal variant calls aria-hidden(hideOthers)
// and mutates the surrounding document, which a detached test mount trips over.
const props = withDefaults(
  defineProps<{
    title: string;
    description?: string;
    overlayClass?: string;
    dialogClass?: string;
    closeOnOverlay?: boolean;
  }>(),
  {
    description: '',
    overlayClass: '',
    dialogClass: '',
    closeOnOverlay: true,
  }
);

const emit = defineEmits<{ close: [] }>();

const dialogRef = ref<HTMLElement | null>(null);
// A stable per-instance suffix keeps the two ids unique when two dialogs exist.
const instanceId = `app-dialog-${Math.random().toString(36).slice(2, 10)}`;
const titleId = computed(() => `${instanceId}-title`);
const descriptionId = computed(() => `${instanceId}-description`);

const onOverlayMouseDown = () => {
  if (props.closeOnOverlay) emit('close');
};

// Focus lands on the first control (or the dialog itself), never on <body>, so
// the next Tab continues inside the dialog.
const onMountAutoFocus = (event: Event) => {
  event.preventDefault();
  const target = dialogRef.value;
  if (!target) return;
  const first = target.querySelector<HTMLElement>(
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
  );
  (first ?? target).focus();
};
</script>

<style scoped>
.app-dialog-overlay {
  position: fixed;
  inset: 0;
  z-index: var(--z-modal);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow-y: auto;
  padding: clamp(12px, 4vw, 24px);
  background: var(--scrim);
  backdrop-filter: blur(4px);
}

.app-dialog {
  display: flex;
  width: 100%;
  max-width: 500px;
  max-height: calc(100dvh - 2 * clamp(12px, 4vw, 24px));
  flex-direction: column;
  overflow: hidden;
  box-sizing: border-box;
  border: 1px solid var(--border-color);
  border-radius: 16px;
  background: var(--bg-primary);
  box-shadow: var(--surface-shadow-lg);
}

/* The visible dialog heading is rendered by the caller; this one exists only to
   give the dialog an accessible name without duplicating the text on screen. */
.app-dialog-sr-title {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
  border: 0;
}
</style>
