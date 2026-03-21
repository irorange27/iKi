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
      <button class="sidebar-tool-btn icon-btn" @click="sidebar.toggle" aria-label="Toggle sidebar">
        <PanelLeftDashed :size="18" />
      </button>

      <button class="sidebar-tool-btn icon-btn" aria-label="Search">
        <Search :size="18" />
      </button>

      <button class="sidebar-tool-btn icon-btn" aria-label="New chat" @click="handleNewChat">
        <SquarePen :size="18" />
      </button>
    </div>

    <div v-if="sidebar.isExpanded.value" class="flex flex-1 min-h-0 pr-2">
      <!-- Chat History -->
      <div class="flex-1 px-3 py-2 min-w-48 overflow-y-scroll custom-scrollbar overscroll-contain">
        <div v-for="chat in chatThreads" :key="chat.id" class="chat-item-row group relative mb-1">
          <button
            class="chat-item w-full truncate rounded-lg px-3 py-2.5 pr-10 text-left text-sm focus:outline-none"
            :class="{ 'chat-item-active': currentThreadId === chat.id }"
            @click="selectThread(chat.id)"
          >
            {{ chat.title }}
          </button>
          <button
            class="chat-delete-btn"
            :class="{ 'chat-delete-btn-visible': deletingThreadIds[chat.id] }"
            :disabled="!!deletingThreadIds[chat.id]"
            aria-label="Delete chat"
            @click="handleDeleteThread(chat, $event)"
          >
            <Trash2 :size="14" />
          </button>
        </div>
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
      <button
        class="sidebar-settings-btn icon-btn ui-text-secondary flex h-8 w-8 items-center justify-center rounded-lg"
        @click="openSettings"
      >
        <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M12 12h.01M12 12h.01M19 12h.01M6 12a1 1 0 11-2 0 1 1 0 012 0zm7 0a1 1 0 11-2 0 1 1 0 012 0zm7 0a1 1 0 11-2 0 1 1 0 012 0z"
          />
        </svg>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from 'vue';
import { PanelLeftDashed, Search, SquarePen, Trash2 } from 'lucide-vue-next';
import { useSidebar } from '../composables/useSidebar';

const sidebar = useSidebar();
const electronAPI = window.electronAPI as NonNullable<typeof window.electronAPI>;

interface ChatThread {
  id: string;
  title: string;
  model?: string;
  updated_at: string;
  client_id?: string;
  metadata?: string;
}

const chatThreads = ref<ChatThread[]>([]);
const currentThreadId = ref<string | null>(null);
const deletingThreadIds = ref<Record<string, boolean>>({});

const NON_DESKTOP_SOURCES = new Set(['napcat']);
const NON_DESKTOP_PREFIXES = ['napcat_'];

const parseThreadSource = (metadataRaw: string | undefined): string => {
  if (!metadataRaw || typeof metadataRaw !== 'string' || !metadataRaw.trim()) return '';
  try {
    const parsed = JSON.parse(metadataRaw) as { source?: unknown };
    return typeof parsed.source === 'string' ? parsed.source.trim().toLowerCase() : '';
  } catch {
    return '';
  }
};

const isDesktopMainUiThread = (thread: ChatThread): boolean => {
  const threadId = typeof thread.id === 'string' ? thread.id.trim() : '';
  if (!threadId) return false;

  if (NON_DESKTOP_PREFIXES.some(prefix => threadId.startsWith(prefix))) {
    return false;
  }

  const clientId = typeof thread.client_id === 'string' ? thread.client_id.trim() : '';
  if (clientId === 'client_napcat') {
    return false;
  }

  const source = parseThreadSource(thread.metadata);
  if (source && NON_DESKTOP_SOURCES.has(source)) {
    return false;
  }

  return true;
};

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
    chatThreads.value = Array.isArray(threads)
      ? (threads as ChatThread[]).filter(isDesktopMainUiThread)
      : [];
  } catch (error) {
    console.error('Failed to load chat threads:', error);
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

  const confirmed = window.confirm(`Delete "${thread.title}"?\nThis cannot be undone.`);
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
    console.error('Failed to delete thread:', error);
  } finally {
    deletingThreadIds.value = {
      ...deletingThreadIds.value,
      [thread.id]: false,
    };
  }
};

// Watch for thread updates
watch(
  () => chatThreads.value,
  () => {
    // Threads updated
  },
  { deep: true }
);

// Expose refresh function for parent
defineExpose({
  refresh: loadChatThreads,
  setCurrentThread: (id: string | null) => {
    currentThreadId.value = id;
  },
});

onMounted(() => {
  loadChatThreads();
  // Refresh threads periodically or when needed
  // You can also listen to events from ChatView
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
.sidebar-settings-btn {
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
  transition: all 0.2s;
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
