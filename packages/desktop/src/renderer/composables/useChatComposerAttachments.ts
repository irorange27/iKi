import { computed, ref } from 'vue';
import type { ComputedRef } from 'vue';
import type { UiFilePart as FileUIPart } from '@iki/ai/message/ui_protocol';

type ImagePayload = { mediaType: string; url: string; filename?: string };

/**
 * Composer attachment state: pasted/dropped images, the viewer target and the
 * vision-capability warning. Send path consumes `attachedImages` directly.
 */
export const useChatComposerAttachments = (deps: {
  modelSupportsVision: ComputedRef<boolean>;
}) => {
  const attachedImages = ref<FileUIPart[]>([]);
  const viewerSrc = ref('');

  const showVisionWarning = computed(
    () => attachedImages.value.length > 0 && !deps.modelSupportsVision.value
  );

  const appendImages = (payloads: ImagePayload[]) => {
    attachedImages.value = [
      ...attachedImages.value,
      ...payloads.map(p => ({
        type: 'file' as const,
        mediaType: p.mediaType,
        url: p.url,
        filename: p.filename,
      })),
    ];
  };

  const handlePasteImage = (payload: ImagePayload) => appendImages([payload]);
  const handleDropImages = (payloads: ImagePayload[]) => appendImages(payloads);

  const removeAttachedImage = (index: number) => {
    attachedImages.value = attachedImages.value.filter((_, i) => i !== index);
  };

  return {
    attachedImages,
    viewerSrc,
    showVisionWarning,
    handlePasteImage,
    handleDropImages,
    removeAttachedImage,
  };
};
