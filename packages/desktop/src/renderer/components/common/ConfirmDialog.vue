<template>
  <DialogRoot
    :open="dialog.visible.value"
    @update:open="value => { if (!value) dialog.dismiss(); }"
  >
    <DialogPortal>
      <DialogOverlay class="confirm-dialog-backdrop" />
      <DialogContent
        class="confirm-dialog"
        role="alertdialog"
        :aria-label="dialog.options.value?.title ?? dialog.options.value?.message"
        :aria-describedby="undefined"
      >
        <DialogTitle v-if="dialog.options.value?.title" class="confirm-dialog-title ui-text-primary">
          {{ dialog.options.value.title }}
        </DialogTitle>
        <DialogDescription class="confirm-dialog-message">{{ dialog.options.value?.message }}</DialogDescription>
        <div class="confirm-dialog-actions">
          <DialogClose as-child>
            <button class="confirm-dialog-btn" type="button">
              {{ dialog.options.value?.cancelLabel ?? t('common.cancel') }}
            </button>
          </DialogClose>
          <button
            class="confirm-dialog-btn confirm-dialog-btn-primary"
            :class="{ 'confirm-dialog-btn-danger': dialog.options.value?.danger }"
            type="button"
            @click="dialog.accept()"
          >
            {{ dialog.options.value?.confirmLabel ?? t('common.confirm') }}
          </button>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>

<script setup lang="ts">
import {
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
} from 'reka-ui';

import { useI18n } from '../../i18n';
import { useConfirmDialog } from '../../composables/useConfirm';

const dialog = useConfirmDialog();
const { t } = useI18n();
</script>

<style scoped>
.confirm-dialog-backdrop {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: var(--z-modal);
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(4px);
}

.confirm-dialog {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  z-index: var(--z-modal);
  width: 100%;
  max-width: 380px;
  border: 1px solid var(--border-color);
  border-radius: 14px;
  background: var(--bg-primary);
  box-shadow: var(--surface-shadow-lg);
  padding: 20px 22px;
}

.confirm-dialog-title {
  margin: 0 0 6px;
  font-size: 15px;
  font-weight: 600;
}

.confirm-dialog-message {
  margin: 0;
  font-size: 13px;
  line-height: 1.55;
  color: var(--text-secondary);
  white-space: pre-line;
}

.confirm-dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 18px;
}

.confirm-dialog-btn {
  padding: 7px 14px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-secondary);
  color: var(--text-primary);
  font-size: 13px;
  cursor: pointer;
  transition:
    background-color 0.15s ease,
    border-color 0.15s ease,
    color 0.15s ease;
}

.confirm-dialog-btn:hover {
  background: var(--bg-hover);
}

.confirm-dialog-btn-primary {
  background: var(--accent-color);
  border-color: var(--accent-color);
  color: var(--accent-contrast);
}

.confirm-dialog-btn-primary:hover {
  background: var(--accent-hover);
  border-color: var(--accent-hover);
}

.confirm-dialog-btn-danger {
  background: var(--danger-color);
  border-color: var(--danger-color);
}

.confirm-dialog-btn-danger:hover {
  filter: brightness(1.08);
  background: var(--danger-color);
  border-color: var(--danger-color);
}
</style>
