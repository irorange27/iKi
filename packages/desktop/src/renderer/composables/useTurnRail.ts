import { ref, watch, nextTick, onMounted, onBeforeUnmount, type Ref } from 'vue';
import {
  extractTextFromMessageParts,
  type ChatUiMessage,
} from '@iki/backend/message/message_parts';

export const useTurnRail = (
  chatMessages: Ref<ChatUiMessage[]>,
  messagesContainer: Ref<HTMLElement | null>,
  threadId: Ref<string | undefined>,
  visible: Ref<boolean>
) => {
  // ── Fixed turn rail (Codex-style outline scrubber) ─────────────────────
  // A strip pinned to the conversation's left edge carries one lines-marker per
  // user message, stacked as a vertically centered column regardless of scroll.
  // Hovering a marker previews the turn; clicking the marker or the preview card
  // smooth-scrolls back to the turn's first message. The rail only appears once
  // the conversation actually overflows.
  const TURN_PREVIEW_HIDE_DELAY_MS = 220;
  const TURN_RAIL_MIN_OVERFLOW_PX = 80;
  // A rail over a short conversation is noise — it earns its place once there
  // are enough turns to navigate between (and the thread actually overflows).
  const TURN_RAIL_MIN_TURNS = 5;

  const turnPreview = ref<{
    messageId: string;
    anchor: { top: number; left: number };
    messages: ChatUiMessage[];
  } | null>(null);
  const turnMarkers = ref<Array<string>>([]);
  const turnHighlightIds = ref<Set<string> | null>(null);
  let turnPreviewHideTimer: ReturnType<typeof setTimeout> | null = null;
  let railResizeObserver: ResizeObserver | null = null;
  let measureRaf: number | null = null;
  let disposed = false;
  let observedRailContent: HTMLElement | null = null;

  const cancelTurnPreviewHide = () => {
    if (turnPreviewHideTimer) {
      clearTimeout(turnPreviewHideTimer);
      turnPreviewHideTimer = null;
    }
  };

  const hideTurnPreview = () => {
    cancelTurnPreviewHide();
    turnPreview.value = null;
    turnHighlightIds.value = null;
  };

  const scheduleTurnPreviewHide = () => {
    cancelTurnPreviewHide();
    turnPreviewHideTimer = setTimeout(() => {
      turnPreviewHideTimer = null;
      hideTurnPreview();
    }, TURN_PREVIEW_HIDE_DELAY_MS);
  };

  const buildTurnMessages = (messageId: string): ChatUiMessage[] => {
    const startIndex = chatMessages.value.findIndex(message => message.id === messageId);
    if (startIndex < 0) return [];
    const turnMessages: ChatUiMessage[] = [];
    for (let index = startIndex; index < chatMessages.value.length; index += 1) {
      const message = chatMessages.value[index];
      if (index > startIndex && message.role === 'user') break;
      turnMessages.push(message);
    }
    return turnMessages;
  };

  const showTurnPreviewFromRail = (event: MouseEvent, messageId: string) => {
    cancelTurnPreviewHide();
    const turnMessages = buildTurnMessages(messageId);
    if (!turnMessages.some(message => extractTextFromMessageParts(message.parts).trim())) {
      return;
    }
    const target = event.currentTarget as HTMLElement | null;
    if (!target) return;
    const rect = target.getBoundingClientRect();
    turnPreview.value = {
      messageId,
      anchor: { top: rect.top - 6, left: rect.right + 6 },
      messages: turnMessages,
    };
    turnHighlightIds.value = new Set(turnMessages.map(message => message.id));
  };

  const scrollToMessage = (messageId: string) => {
    if (!messagesContainer.value) return;
    messagesContainer.value
      .querySelector(`[data-message-id="${CSS.escape(messageId)}"]`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const jumpToTurn = (messageId: string) => {
    hideTurnPreview();
    scrollToMessage(messageId);
  };

  const activateTurnPreview = () => {
    const messageId = turnPreview.value?.messageId;
    hideTurnPreview();
    if (messageId) scrollToMessage(messageId);
  };

  const attachRailResizeObserver = (content: HTMLElement | null) => {
    if (!content) {
      railResizeObserver?.disconnect();
      observedRailContent = null;
      return;
    }
    if (observedRailContent === content) return;
    railResizeObserver?.disconnect();
    observedRailContent = content;
    railResizeObserver?.observe(content);
    if (messagesContainer.value) railResizeObserver?.observe(messagesContainer.value);
  };

  const measureTurnMarkers = () => {
    if (!visible.value) return;
    const container = messagesContainer.value;
    const content = container?.querySelector<HTMLElement>('.messages-container') ?? null;
    attachRailResizeObserver(content);
    if (
      !container ||
      !content ||
      container.scrollHeight <= container.clientHeight + TURN_RAIL_MIN_OVERFLOW_PX
    ) {
      if (turnMarkers.value.length) turnMarkers.value = [];
      return;
    }
    const markerIds: Array<string> = [];
    content
      .querySelectorAll<HTMLElement>('.message-wrapper.user[data-message-id]')
      .forEach(node => {
        const messageId = node.dataset.messageId;
        if (messageId) markerIds.push(messageId);
      });
    const next = markerIds.length >= TURN_RAIL_MIN_TURNS ? markerIds : [];
    if (
      next.length !== turnMarkers.value.length ||
      next.some((id, i) => id !== turnMarkers.value[i])
    ) {
      turnMarkers.value = next;
    }
  };

  onBeforeUnmount(() => {
    disposed = true;
    railResizeObserver?.disconnect();
    railResizeObserver = null;
    hideTurnPreview();
    if (measureRaf !== null) cancelAnimationFrame(measureRaf);
  });

  const scheduleMeasure = () => {
    if (disposed || measureRaf !== null) return;
    measureRaf = requestAnimationFrame(() => {
      measureRaf = null;
      measureTurnMarkers();
    });
  };
  onMounted(() => {
    railResizeObserver = new ResizeObserver(scheduleMeasure);
    scheduleMeasure();
  });
  watch(
    () => [chatMessages.value.length, threadId.value, visible.value],
    () => {
      hideTurnPreview();
      void nextTick(scheduleMeasure);
    }
  );
  return {
    turnPreview,
    turnMarkers,
    turnHighlightIds,
    cancelTurnPreviewHide,
    scheduleTurnPreviewHide,
    showTurnPreviewFromRail,
    jumpToTurn,
    activateTurnPreview,
  };
};
