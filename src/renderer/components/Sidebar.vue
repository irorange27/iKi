<template>
  <div
    class="sidebar-shell app-text relative flex flex-col top-1 bottom-1 transition-all rounded-lg duration-300 ease-in-out"
    :class="{
      'm-1 border-2': !sidebar.isCollapsed.value,
      'm-0 border-0 sidebar-shell-collapsed': sidebar.isCollapsed.value,
    }"
    :style="{
      width: sidebar.isCollapsed.value ? '0px' : `${sidebar.width.value}px`,
    }"
  >
    <!-- Toggle Button Container -->
    <!-- When collapsed, we use fixed positioning to keep it in the top-left area -->
    <div
      class="toolbar-container transition-all duration-300"
      :class="{
        'fixed top-4 left-20 z-[100] flex items-center gap-1': sidebar.isCollapsed.value,
        'flex pl-20 p-2 max-h-12 flex-shrink-0': !sidebar.isCollapsed.value,
      }"
    >
      <button
        class="sidebar-tool-btn icon-btn"
        @click="sidebar.toggle"
        :aria-label="t('chat.sidebar.toggle')"
      >
        <PanelLeftDashed :size="18" />
      </button>

      <button class="sidebar-tool-btn icon-btn" :aria-label="t('chat.sidebar.search')">
        <Search :size="18" />
      </button>

      <button
        class="sidebar-tool-btn icon-btn"
        :aria-label="t('chat.sidebar.newChat')"
        @click="handleNewChat"
      >
        <SquarePen :size="18" />
      </button>
    </div>

    <div v-if="sidebar.isExpanded.value" class="flex flex-1 min-h-0 pr-2">
      <!-- Chat History -->
      <div class="flex-1 px-3 py-2 min-w-48 overflow-y-scroll custom-scrollbar overscroll-contain">
        <div
          v-for="chat in desktopThreads"
          :key="chat.id"
          class="chat-item-row group relative mb-1"
        >
          <button
            class="chat-item w-full truncate rounded-lg px-3 py-2.5 pr-10 text-left text-sm focus:outline-none"
            :class="{ 'chat-item-active': currentThreadId === chat.id }"
            :title="chat.title"
            @click="selectThread(chat.id)"
          >
            <span class="chat-item-title">{{ chat.title }}</span>
          </button>
          <button
            class="chat-delete-btn"
            :class="{ 'chat-delete-btn-visible': deletingThreadIds[chat.id] }"
            :disabled="!!deletingThreadIds[chat.id]"
            :aria-label="t('chat.sidebar.deleteChat')"
            @click="handleDeleteThread(chat, $event)"
          >
            <Trash2 :size="14" />
          </button>
        </div>

        <section v-if="shouldShowExternalSection" class="sidebar-section">
          <div v-if="desktopThreads.length > 0" class="sidebar-section-divider"></div>
          <div class="sidebar-section-header">
            <span>{{ t('chat.sidebar.externalChats') }}</span>
            <span class="sidebar-section-count">{{ externalThreads.length }}</span>
          </div>

          <div
            v-for="chat in externalThreads"
            :key="chat.id"
            class="chat-item-row chat-item-row-external mb-1"
          >
            <button
              class="chat-item chat-item-external w-full rounded-lg px-3 py-2.5 text-left text-sm focus:outline-none"
              :class="{ 'chat-item-active': currentThreadId === chat.id }"
              :title="chat.title"
              @click="selectThread(chat.id)"
            >
              <span class="chat-item-title">{{ chat.title }}</span>
              <span class="chat-item-meta">
                <span v-if="getThreadOrigin(chat).sourceLabel" class="chat-item-badge">
                  {{ getThreadOrigin(chat).sourceLabel }}
                </span>
                <span v-if="getThreadOrigin(chat).channelLabel" class="chat-item-channel">
                  {{ getThreadOrigin(chat).channelLabel }}
                </span>
              </span>
            </button>
          </div>
        </section>
      </div>
      <!-- draggable handle -->
      <div
        class="resize-handle absolute top-0 right-0 z-10 h-full w-1 cursor-col-resize transition-colors group"
        @mousedown="startResize"
        @touchstart="startResize"
      >
        <!-- Visual Indicator -->
        <div
          class="resize-handle-indicator absolute top-1/2 left-1/2 h-8 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full opacity-0 transition-opacity group-hover:opacity-100"
        ></div>
      </div>
    </div>

    <!-- Sidebar Footer -->
    <div v-if="sidebar.isExpanded.value" class="relative p-3 mt-auto flex">
      <div
        ref="menuAnchorRef"
        class="sidebar-menu-anchor"
        @mouseenter="openMenu"
        @mouseleave="closeMenu"
        @focusin="openMenu"
        @focusout="handleMenuFocusOut"
      >
        <button
          class="sidebar-menu-btn icon-btn ui-text-secondary flex h-8 w-8 items-center justify-center rounded-lg"
          :aria-label="t('chat.sidebar.menu')"
          aria-haspopup="menu"
          :aria-expanded="isMenuOpen"
          @click="toggleMenu"
        >
          <MoreHorizontal :size="18" />
        </button>
        <div v-if="isMenuOpen" class="sidebar-menu" role="menu">
          <button class="sidebar-menu-item" role="menuitem" @click="handleOpenSettings">
            <span class="sidebar-menu-item-icon">
              <Settings2 :size="14" />
            </span>
            <span class="sidebar-menu-item-label text-sm">{{ t('chat.welcome.settings') }}</span>
          </button>
          <button
            class="sidebar-menu-item"
            role="menuitemcheckbox"
            :aria-checked="sidebar.showExternalChats.value"
            @click="toggleExternalChats"
          >
            <span class="sidebar-menu-item-icon">
              <MessageSquareShare :size="16" />
            </span>
            <span class="sidebar-menu-item-label text-sm">{{
              t('chat.sidebar.showExternalChats')
            }}</span>
            <span
              class="sidebar-menu-item-check"
              :class="{ visible: sidebar.showExternalChats.value }"
            >
              <Check :size="14" />
            </span>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import {
  Check,
  MessageSquareShare,
  MoreHorizontal,
  PanelLeftDashed,
  Search,
  Settings2,
  SquarePen,
  Trash2,
} from 'lucide-vue-next';
import { createLogger } from '../logger';
import { useI18n } from '../i18n';
import { useSidebar } from '../composables/useSidebar';
import { getThreadOriginInfo, isExternalThread } from '../modules/chat/thread_origin';

const sidebar = useSidebar();
const { t } = useI18n();
const electronAPI = window.electronAPI as NonNullable<typeof window.electronAPI>;
const sidebarLogger = createLogger({ module: 'sidebar' });

interface ChatThread {
  id: string;
  title: string;
  model?: string;
  updated_at: string;
  client_id?: string;
  metadata: string;
}

const chatThreads = ref<ChatThread[]>([]);
const currentThreadId = ref<string | null>(null);
const deletingThreadIds = ref<Record<string, boolean>>({});
const isMenuOpen = ref(false);
const menuAnchorRef = ref<HTMLElement | null>(null);

// Emit events to parent
const emit = defineEmits<{
  'thread-selected': [threadId: string];
  'new-chat': [];
  'thread-deleted': [threadId: string];
}>();

// Load chat threads from database
const loadChatThreads = async () => {
  try {
    const threads = await electronAPI.chat.threads.list();
    chatThreads.value = Array.isArray(threads) ? (threads as ChatThread[]) : [];
  } catch (error) {
    sidebarLogger.event({
      level: 'error',
      event: 'chat.threads.load',
      outcome: 'failed',
      error,
    });
  }
};

// Select a thread
const selectThread = (threadId: string) => {
  currentThreadId.value = threadId;
  emit('thread-selected', threadId);
};

// Handle new chat button
const handleNewChat = () => {
  currentThreadId.value = null;
  emit('new-chat');
};

const handleDeleteThread = async (thread: ChatThread, event: MouseEvent) => {
  event.preventDefault();
  event.stopPropagation();

  if (deletingThreadIds.value[thread.id]) return;

  const confirmed = window.confirm(t('chat.sidebar.deleteConfirm', { title: thread.title }));
  if (!confirmed) return;

  deletingThreadIds.value[thread.id] = true;
  try {
    await electronAPI.chat.threads.delete(thread.id);
    chatThreads.value = chatThreads.value.filter(chat => chat.id !== thread.id);
    if (currentThreadId.value === thread.id) {
      currentThreadId.value = null;
    }
    emit('thread-deleted', thread.id);
  } catch (error) {
    sidebarLogger.event({
      level: 'error',
      event: 'chat.thread.delete',
      outcome: 'failed',
      error,
      entity: {
        thread_id: thread.id,
      },
    });
  } finally {
    deletingThreadIds.value = {
      ...deletingThreadIds.value,
      [thread.id]: false,
    };
  }
};

const desktopThreads = computed(() =>
  chatThreads.value.filter(thread => !isExternalThread(thread))
);
const externalThreads = computed(() => chatThreads.value.filter(isExternalThread));
const isCurrentThreadExternal = computed(() => {
  const threadId = typeof currentThreadId.value === 'string' ? currentThreadId.value : '';
  if (!threadId) return false;
  const activeThread = chatThreads.value.find(thread => thread.id === threadId);
  return activeThread ? isExternalThread(activeThread) : false;
});
const shouldShowExternalSection = computed(
  () =>
    externalThreads.value.length > 0 &&
    (sidebar.showExternalChats.value || isCurrentThreadExternal.value)
);
const threadOriginMap = computed(() => {
  return new Map(chatThreads.value.map(thread => [thread.id, getThreadOriginInfo(thread)]));
});

const getThreadOrigin = (thread: ChatThread) =>
  threadOriginMap.value.get(thread.id) ?? getThreadOriginInfo(thread);

const closeMenu = () => {
  isMenuOpen.value = false;
};

const openMenu = () => {
  isMenuOpen.value = true;
};

const toggleMenu = () => {
  isMenuOpen.value = !isMenuOpen.value;
};

const handleOpenSettings = () => {
  closeMenu();
  openSettings();
};

const toggleExternalChats = () => {
  sidebar.toggleExternalChats();
  closeMenu();
};

const handleDocumentPointerDown = (event: PointerEvent) => {
  if (!isMenuOpen.value) return;
  const anchor = menuAnchorRef.value;
  if (!anchor) {
    closeMenu();
    return;
  }

  const target = event.target;
  if (target instanceof Node && anchor.contains(target)) return;
  closeMenu();
};

const handleMenuFocusOut = (event: FocusEvent) => {
  const anchor = menuAnchorRef.value;
  if (!anchor) {
    closeMenu();
    return;
  }

  const nextTarget = event.relatedTarget;
  if (nextTarget instanceof Node && anchor.contains(nextTarget)) return;
  closeMenu();
};

// Expose refresh function for parent
defineExpose({
  refresh: loadChatThreads,
  setCurrentThread: (id: string | null) => {
    currentThreadId.value = id;
  },
});

onMounted(() => {
  loadChatThreads();
  document.addEventListener('pointerdown', handleDocumentPointerDown);
});

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', handleDocumentPointerDown);
});

const MIN_WIDTH = 210; // 最小宽度 (Tailwind w-64)
const MAX_WIDTH = 500; // 最大宽度

interface StartResizeEvent extends Partial<MouseEvent>, Partial<TouchEvent> {
  type: string;
  touches?: TouchList;
  clientX?: number;
  preventDefault: () => void;
}

const startResize = (e: StartResizeEvent) => {
  e.preventDefault?.();

  // 类型守卫：区分鼠标和触摸事件
  const isTouch = e.type.startsWith('touch');
  const startX = isTouch ? (e.touches?.[0].clientX ?? 0) : (e.clientX ?? 0);
  const startWidth = sidebar.width.value;

  const handleMove = (moveEvent: MouseEvent | TouchEvent) => {
    const moveIsTouch = moveEvent.type.startsWith('touch');
    const clientX = moveIsTouch
      ? ((moveEvent as TouchEvent).touches[0]?.clientX ?? 0)
      : (moveEvent as MouseEvent).clientX;

    const deltaX = clientX - startX;
    const newWidth = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, startWidth + deltaX));

    sidebar.setWidth(newWidth);
  };

  const handleMouseMove = (moveEvent: MouseEvent) => {
    handleMove(moveEvent);
  };

  const handleTouchMove = (moveEvent: TouchEvent) => {
    handleMove(moveEvent);
  };

  const handleEnd = () => {
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', handleEnd);
    document.removeEventListener('touchmove', handleTouchMove);
    document.removeEventListener('touchend', handleEnd);
  };

  // 统一监听鼠标和触摸事件
  document.addEventListener('mousemove', handleMouseMove);
  document.addEventListener('mouseup', handleEnd);
  document.addEventListener('touchmove', handleTouchMove, {
    passive: false,
  });
  document.addEventListener('touchend', handleEnd);
};

const openSettings = () => {
  electronAPI?.openSettings?.();
};
</script>

<style scoped>
.sidebar-shell {
  min-width: 210px;
  margin-bottom: var(--chat-composer-padding, 10px);
  overflow: hidden;
  background-color: var(--bg-secondary);
  border-color: var(--border-color);
}

.sidebar-shell-collapsed {
  min-width: 0;
  margin-bottom: 0;
  overflow: visible;
  background-color: transparent;
}

.sidebar-tool-btn,
.sidebar-menu-btn {
  background: none;
  border: none;
  border-radius: 6px;
  padding-top: 0;
  color: var(--text-secondary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition:
    background-color 0.2s,
    color 0.2s;
  -webkit-app-region: no-drag;
}

.sidebar-tool-btn {
  width: 24px;
  height: 24px;
}

.resize-handle {
  -webkit-app-region: no-drag;
}

.resize-handle-indicator {
  background-color: var(--sidebar-resize-indicator-color);
}

.resize-handle:hover {
  background-color: var(--accent-color);
  opacity: 0.5;
}

/* Chat Item Styles */
.chat-item {
  color: var(--text-secondary);
  transition:
    background-color 0.2s,
    color 0.2s;
}

.chat-item-row:hover .chat-delete-btn,
.chat-delete-btn-visible {
  opacity: 1;
}

.chat-item:hover {
  background-color: var(--bg-hover);
  color: var(--text-primary);
}

.chat-item:focus {
  background-color: var(--bg-active);
  color: var(--text-primary);
}

.chat-item-active {
  background-color: var(--bg-active);
  color: var(--text-primary);
  font-weight: 500;
}

.chat-item-title {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chat-item-external {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 8px;
  padding-right: 12px;
}

.chat-item-external .chat-item-title {
  white-space: normal;
  word-break: break-word;
  line-height: 1.35;
}

.chat-item-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.chat-item-badge {
  border-radius: 999px;
  border: 1px solid var(--border-color);
  background: var(--bg-tertiary);
  color: var(--text-secondary);
  padding: 2px 8px;
  font-size: 11px;
  line-height: 1.2;
}

.chat-item-channel {
  color: var(--text-muted);
  font-size: 11px;
  line-height: 1.2;
}

.sidebar-section {
  margin-top: 14px;
}

.sidebar-section-divider {
  height: 1px;
  margin-bottom: 12px;
  background: var(--border-color);
}

.sidebar-section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
  padding: 0 4px;
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 650;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.sidebar-section-count {
  border-radius: 999px;
  background: var(--bg-tertiary);
  color: var(--text-secondary);
  padding: 1px 7px;
  font-size: 10px;
}

.chat-delete-btn {
  position: absolute;
  right: 6px;
  top: 50%;
  transform: translateY(-50%);
  width: 24px;
  height: 24px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-muted);
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition:
    opacity 0.2s,
    background-color 0.2s,
    color 0.2s;
  cursor: pointer;
  -webkit-app-region: no-drag;
}

.chat-delete-btn:hover:not(:disabled) {
  color: var(--status-danger-color);
  background-color: var(--bg-hover);
}

.chat-delete-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.bg-secondary-with-opacity {
  background-color: var(--bg-secondary);
  opacity: 0.9;
  backdrop-filter: blur(4px);
  border: 1px solid var(--border-color);
}

.toolbar-container.fixed {
  z-index: 100;
  pointer-events: auto;
}

.sidebar-menu-anchor {
  position: relative;
}

.sidebar-menu {
  position: absolute;
  left: 0;
  bottom: calc(100% + 8px);
  display: flex;
  min-width: 220px;
  flex-direction: column;
  gap: 4px;
  border-radius: 14px;
  border: 1px solid var(--border-color);
  background: color-mix(in srgb, var(--bg-secondary) 92%, transparent);
  padding: 8px;
  box-shadow: var(--app-shell-shadow);
  backdrop-filter: blur(16px);
  z-index: 60;
}

.sidebar-menu-item {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 10px;
  border: none;
  border-radius: 10px;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  padding: 10px 12px;
  text-align: left;
  transition:
    background-color 0.2s,
    color 0.2s;
}

.sidebar-menu-item:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.sidebar-menu-item-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: inherit;
}

.sidebar-menu-item-label {
  flex: 1;
  min-width: 0;
}

.sidebar-menu-item-check {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--accent-color);
  opacity: 0;
  transition: opacity 0.2s;
}

.sidebar-menu-item-check.visible {
  opacity: 1;
}

/* Custom Scrollbar */
.custom-scrollbar::-webkit-scrollbar {
  width: 8px;
}

.custom-scrollbar::-webkit-scrollbar-track {
  background: transparent;
  margin: 4px 0;
  /* 增加上下间距，视觉上变短 */
}

.custom-scrollbar::-webkit-scrollbar-thumb {
  background-color: var(--border-color);
  border-radius: 4px;
}

.custom-scrollbar::-webkit-scrollbar-thumb:hover {
  background-color: var(--text-muted);
}
</style>
