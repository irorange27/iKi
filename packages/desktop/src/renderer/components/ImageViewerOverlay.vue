<template>
  <Teleport to="body">
    <div
      v-if="visible"
      class="image-viewer-backdrop"
      role="dialog"
      aria-label="Image preview"
      @click.self="emit('close')"
      @keydown.escape="emit('close')"
    >
      <button class="image-viewer-close" type="button" :aria-label="t('common.close')" @click="emit('close')">
        <span aria-hidden="true">&times;</span>
      </button>
      <img :src="src" :alt="alt || 'Preview'" class="image-viewer-img" />
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { useI18n } from '../i18n';

defineProps<{
  visible: boolean;
  src: string;
  alt?: string;
}>();

const emit = defineEmits<{
  (event: 'close'): void;
}>();

const { t } = useI18n();
</script>

<style scoped>
.image-viewer-backdrop {
  position: fixed;
  inset: 0;
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.78);
  backdrop-filter: blur(12px);
  animation: imageViewerFadeIn 0.18s ease;
}

.image-viewer-close {
  position: absolute;
  top: 18px;
  right: 18px;
  width: 40px;
  height: 40px;
  border: 0;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.12);
  color: #fff;
  font-size: 24px;
  line-height: 1;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s ease;
}

.image-viewer-close:hover {
  background: rgba(255, 255, 255, 0.22);
}

.image-viewer-img {
  max-width: 90vw;
  max-height: 90vh;
  border-radius: 14px;
  object-fit: contain;
  box-shadow: 0 24px 80px rgba(0, 0, 0, 0.45);
  animation: imageViewerScaleIn 0.22s ease;
}

@keyframes imageViewerFadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes imageViewerScaleIn {
  from { opacity: 0; transform: scale(0.94); }
  to { opacity: 1; transform: scale(1); }
}
</style>
