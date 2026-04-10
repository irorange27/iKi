// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';

import { useChatComposerDraft } from '../../../src/renderer/composables/useChatComposerDraft';

const createEnterEvent = (overrides?: Partial<KeyboardEvent>): KeyboardEvent =>
  ({
    isComposing: false,
    keyCode: 13,
    preventDefault: vi.fn(),
    which: 13,
    ...overrides,
  }) as KeyboardEvent;

describe('useChatComposerDraft', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('updates the draft value and can focus/select the input when requested', async () => {
    const inputRef = ref<HTMLTextAreaElement | null>(document.createElement('textarea'));
    const message = ref('');
    const focus = vi.spyOn(inputRef.value as HTMLTextAreaElement, 'focus');
    const select = vi.spyOn(inputRef.value as HTMLTextAreaElement, 'select');
    const state = useChatComposerDraft({
      inputRef,
      message,
      sendMessage: vi.fn(),
      isRecording: ref(false),
      isTranscribing: ref(false),
    });

    await state.setDraftMessage('Investigate the thread', { focus: true, select: true });

    expect(message.value).toBe('Investigate the thread');
    expect(focus).toHaveBeenCalledTimes(1);
    expect(select).toHaveBeenCalledTimes(1);
  });

  it('suppresses Enter while composition is active or has just ended, then resumes send', () => {
    const sendMessage = vi.fn();
    const state = useChatComposerDraft({
      inputRef: ref<HTMLTextAreaElement | null>(null),
      message: ref('Hello'),
      sendMessage,
      isRecording: ref(false),
      isTranscribing: ref(false),
    });

    state.handleCompositionStart();
    state.handleEnter(createEnterEvent());
    expect(sendMessage).not.toHaveBeenCalled();

    state.handleCompositionEnd();
    state.handleEnter(createEnterEvent());
    expect(sendMessage).not.toHaveBeenCalled();

    vi.runAllTimers();
    state.handleEnter(createEnterEvent());
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  it('ignores Enter while speech recording or transcription is active', () => {
    const sendMessage = vi.fn();
    const state = useChatComposerDraft({
      inputRef: ref<HTMLTextAreaElement | null>(null),
      message: ref('Hello'),
      sendMessage,
      isRecording: ref(true),
      isTranscribing: ref(false),
    });

    state.handleEnter(createEnterEvent());
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('lets Shift+Enter pass through so the textarea can stay multiline-capable', () => {
    const preventDefault = vi.fn();
    const sendMessage = vi.fn();
    const state = useChatComposerDraft({
      inputRef: ref<HTMLTextAreaElement | null>(null),
      message: ref('Hello'),
      sendMessage,
      isRecording: ref(false),
      isTranscribing: ref(false),
    });

    state.handleEnter(createEnterEvent({ shiftKey: true, preventDefault }) as KeyboardEvent);

    expect(preventDefault).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
  });
});
