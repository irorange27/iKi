import { nextTick, ref, type Ref } from 'vue';

type ComposerTextControl = HTMLInputElement | HTMLTextAreaElement;

export const useChatComposerDraft = (deps: {
  inputRef: Ref<ComposerTextControl | null>;
  message: Ref<string>;
  sendMessage: () => Promise<void> | void;
  isRecording: Ref<boolean>;
  isTranscribing: Ref<boolean>;
}) => {
  const isComposing = ref(false);
  const justEndedComposition = ref(false);

  const setDraftMessage = async (
    nextValue: string,
    options?: { focus?: boolean; select?: boolean }
  ) => {
    deps.message.value = nextValue;
    await nextTick();
    if (options?.focus) {
      deps.inputRef.value?.focus();
    }
    if (options?.select) {
      deps.inputRef.value?.select();
    }
  };

  const handleCompositionStart = () => {
    isComposing.value = true;
  };

  const handleCompositionEnd = () => {
    isComposing.value = false;
    justEndedComposition.value = true;
    window.setTimeout(() => {
      justEndedComposition.value = false;
    }, 0);
  };

  const handleEnter = (event: KeyboardEvent) => {
    if (
      event.isComposing ||
      event.keyCode === 229 ||
      event.which === 229 ||
      isComposing.value ||
      justEndedComposition.value
    ) {
      return;
    }

    if (event.shiftKey) {
      return;
    }

    event.preventDefault();

    if (deps.isRecording.value || deps.isTranscribing.value) {
      return;
    }

    void deps.sendMessage();
  };

  return {
    inputRef: deps.inputRef,
    message: deps.message,
    setDraftMessage,
    handleCompositionStart,
    handleCompositionEnd,
    handleEnter,
  };
};
