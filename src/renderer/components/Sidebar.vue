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
        @mouseleave="scheduleMenuClose"
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
      </div>
    </div>
  </div>

  <Teleport to="body">
    <div
      v-if="isMenuOpen"
      ref="menuRef"
      class="sidebar-menu"
      :style="menuStyle"
      role="menu"
      @mouseenter="handleMenuMouseEnter"
      @mouseleave="scheduleMenuClose"
      @focusin="openMenu"
      @focusout="handleMenuFocusOut"
    >
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
        <span class="sidebar-menu-item-check" :class="{ visible: sidebar.showExternalChats.value }">
          <Check :size="14" />
        </span>
      </button>
    </div>
  </Teleport>
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
import { getElectronApiMethod, getElectronApiSlice } from '../services/electron_api';

const sidebar = useSidebar();
const { t } = useI18n();
const chatApi = getElectronApiSlice('chat');
const openSettingsWindow = getElectronApiMethod('openSettings');
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
const menuRef = ref<HTMLElement | null>(null);
const menuPosition = ref({
  left: 0,
  bottom: 0,
});
let menuCloseTimer: ReturnType<typeof setTimeout> | null = null;

// Emit events to parent
const emit = defineEmits<{
  'thread-selected': [threadId: string];
  'new-chat': [];
  'thread-deleted': [threadId: string];
}>();

// Load chat threads from database
const loadChatThreads = async () => {
  if (!chatApi?.threads?.list) return;
  try {
    const threads = await chatApi.threads.list();
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
  if (!chatApi?.threads?.delete) {
    deletingThreadIds.value = {
      ...deletingThreadIds.value,
      [thread.id]: false,
    };
    return;
  }
  try {
    await chatApi.threads.delete(thread.id);
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

const updateMenuPosition = () => {
  const anchor = menuAnchorRef.value;
  if (!anchor) return;

  const rect = anchor.getBoundingClientRect();
  menuPosition.value = {
    left: Math.max(8, rect.left),
    bottom: Math.max(8, window.innerHeight - rect.top + 6),
  };
};

const menuStyle = computed(() => ({
  left: `${menuPosition.value.left}px`,
  bottom: `${menuPosition.value.bottom}px`,
  maxWidth: 'min(260px, calc(100vw - 16px))',
}));

const clearMenuCloseTimer = () => {
  if (!menuCloseTimer) return;
  clearTimeout(menuCloseTimer);
  menuCloseTimer = null;
};

const closeMenu = () => {
  clearMenuCloseTimer();
  isMenuOpen.value = false;
};

const openMenu = () => {
  clearMenuCloseTimer();
  updateMenuPosition();
  isMenuOpen.value = true;
};

const scheduleMenuClose = () => {
  clearMenuCloseTimer();
  menuCloseTimer = setTimeout(() => {
    isMenuOpen.value = false;
    menuCloseTimer = null;
  }, 120);
};

const handleMenuMouseEnter = () => {
  openMenu();
};

const toggleMenu = () => {
  if (isMenuOpen.value) {
    closeMenu();
    return;
  }
  openMenu();
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
  const menu = menuRef.value;
  if (!anchor) {
    closeMenu();
    return;
  }

  const target = event.target;
  if (
    target instanceof Node &&
    (anchor.contains(target) || (menu instanceof HTMLElement && menu.contains(target)))
  ) {
    return;
  }
  closeMenu();
};

const handleMenuFocusOut = (event: FocusEvent) => {
  const anchor = menuAnchorRef.value;
  const menu = menuRef.value;
  if (!anchor) {
    closeMenu();
    return;
  }

  const nextTarget = event.relatedTarget;
  if (
    nextTarget instanceof Node &&
    (anchor.contains(nextTarget) || (menu instanceof HTMLElement && menu.contains(nextTarget)))
  ) {
    return;
  }
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
  window.addEventListener('resize', updateMenuPosition);
});

onBeforeUnmount(() => {
  clearMenuCloseTimer();
  document.removeEventListener('pointerdown', handleDocumentPointerDown);
  window.removeEventListener('resize', updateMenuPosition);
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
  openSettingsWindow?.();
};
</script>
<style scoped src="./sidebar.css"></style>
