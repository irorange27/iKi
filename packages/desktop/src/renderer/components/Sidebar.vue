<template>
  <div
    class="sidebar-shell app-text relative flex flex-col top-1 bottom-1 transition-all rounded-lg duration-300 ease-in-out"
    :class="{
      'm-1 border': !sidebar.isCollapsed.value,
      'm-0 border-0 sidebar-shell-collapsed': sidebar.isCollapsed.value,
      'sidebar-resizing': isResizing,
    }"
    :style="{
      width: sidebar.isCollapsed.value ? '0px' : `${sidebar.width.value}px`,
      '--sidebar-width': `${sidebar.width.value}px`,
    }"
  >
    <!-- Collapsed: fixed mini toolbar in the top-left corner. Hidden while the
         chat header is visible — the header renders the same controls inline
         (ChatView leading cluster); this seat covers the headerless welcome. -->
    <div
      v-if="sidebar.isCollapsed.value && !props.hideCollapsedToolbar"
      class="toolbar-container fixed top-4 left-20 z-[var(--z-chrome)] flex items-center gap-1 transition-all duration-300"
    >
      <button class="sidebar-tool-btn icon-btn" @click="sidebar.toggle" :aria-label="t('chat.sidebar.toggle')">
        <PanelLeftDashed :size="18" />
      </button>
      <button class="sidebar-tool-btn icon-btn" :aria-label="t('chat.sidebar.newChat')" @click="handleNewChat">
        <SquarePen :size="18" />
      </button>
    </div>

    <template v-if="contentVisible">
      <!-- Header row -->
      <div class="flex flex-shrink-0 items-center pl-20 pr-3 pt-2.5">
        <button class="sidebar-tool-btn icon-btn" @click="sidebar.toggle" :aria-label="t('chat.sidebar.toggle')">
          <PanelLeftDashed :size="18" />
        </button>
      </div>

      <!-- Action list -->
      <nav class="sidebar-actions flex-shrink-0 px-2 pt-1.5" :aria-label="t('chat.sidebar.menu')">
        <button class="sidebar-action-item" @click="handleNewChat">
          <SquarePen :size="15" />
          <span>{{ t('chat.sidebar.newChat') }}</span>
        </button>
        <button
          class="sidebar-action-item"
          :class="{ 'sidebar-action-item--active': isSearchOpen }"
          :aria-expanded="isSearchOpen"
          @click="toggleSearch"
        >
          <Search :size="15" />
          <span>{{ t('chat.sidebar.search') }}</span>
        </button>
        <button class="sidebar-action-item" @click="openAutomations">
          <AlarmClock :size="15" />
          <span>{{ t('chat.sidebar.automations') }}</span>
        </button>
        <button class="sidebar-action-item" @click="openSettings">
          <Settings2 :size="15" />
          <span>{{ t('chat.welcome.settings') }}</span>
        </button>
      </nav>

      <!-- Grouping mode switcher + new task (lives next to Projects on purpose) -->
      <div class="sidebar-group-row flex-shrink-0 px-2.5 pt-2">
        <div
          class="sidebar-group-switch"
          role="tablist"
          :aria-label="t('chat.sidebar.grouping')"
        >
          <button
            class="sidebar-group-tab"
            :class="{ 'sidebar-group-tab--active': groupMode === 'time' }"
            role="tab"
            :aria-selected="groupMode === 'time'"
            @click="setGroupMode('time')"
          >
            <Hash :size="12" />
            <span>{{ t('chat.sidebar.groupByTime') }}</span>
          </button>
          <button
            class="sidebar-group-tab"
            :class="{ 'sidebar-group-tab--active': groupMode === 'projects' }"
            role="tab"
            :aria-selected="groupMode === 'projects'"
            @click="setGroupMode('projects')"
          >
            <Folder :size="12" />
            <span>{{ t('chat.sidebar.groupByProjects') }}</span>
          </button>
        </div>
        <button
          class="sidebar-new-task-btn icon-btn"
          :aria-label="t('chat.sidebar.newTask')"
          :title="t('chat.sidebar.newTask')"
          @click="handleNewWork"
        >
          <FolderPlus :size="15" />
        </button>
      </div>

      <!-- Search box -->
      <div v-if="isSearchOpen" class="sidebar-search flex-shrink-0 px-3 pt-2">
        <div class="sidebar-search-box">
          <Search :size="14" class="sidebar-search-icon" />
          <input
            ref="searchInputRef"
            v-model="searchQuery"
            class="sidebar-search-input"
            type="text"
            :aria-label="t('a11y.searchChats')"
            :placeholder="t('chat.sidebar.searchPlaceholder')"
            @keydown.escape.stop="closeSearch"
          />
          <button
            v-if="searchQuery"
            class="sidebar-search-clear"
            :aria-label="t('chat.sidebar.clearSearch')"
            @click="clearSearch"
          >
            <X :size="14" />
          </button>
        </div>
      </div>

      <!-- Thread list -->
      <div class="flex-1 px-2.5 py-2 min-w-48 overflow-y-scroll custom-scrollbar overscroll-contain">
        <template v-for="section in threadSections" :key="section.key">
          <div
            v-if="section.name !== null"
            class="sidebar-section-header sidebar-section-header--project"
          >
            <button
              type="button"
              class="sidebar-section-toggle"
              :aria-expanded="!collapsedGroups[section.key]"
              @click="toggleGroupCollapsed(section.key)"
            >
              <span class="sidebar-section-toggle-lead">
                <ChevronDown
                  :size="12"
                  class="sidebar-section-chevron"
                  :class="{ 'is-collapsed': collapsedGroups[section.key] }"
                />
                <Folder :size="13" class="sidebar-section-folder" />
                <span class="sidebar-section-name">{{ section.name }}</span>
              </span>
            </button>
            <PopoverRoot
              v-if="!props.workspaceLocked"
              :open="projectSwitcherSection === section.key"
              @update:open="handleProjectSwitcherOpen(section.key, $event)"
            >
              <PopoverTrigger as-child>
                <button
                  type="button"
                  class="sidebar-project-switch-btn"
                  :aria-label="t('chat.workspace.switchTitle')"
                  :title="t('chat.workspace.switchTitle')"
                >
                  <ArrowLeftRight :size="12" />
                </button>
              </PopoverTrigger>
              <PopoverPortal>
                <PopoverContent
                  class="sidebar-project-panel"
                  side="bottom"
                  align="end"
                  :side-offset="6"
                >
                  <div class="sidebar-project-header">
                    <span class="sidebar-project-title">{{ t('chat.workspace.title') }}</span>
                    <button
                      type="button"
                      class="sidebar-project-add-btn"
                      :disabled="isPickingProjectDirectory"
                      @click.stop="pickProjectDirectory"
                    >
                      {{ isPickingProjectDirectory ? t('chat.workspace.adding') : t('common.addFolder') }}
                    </button>
                  </div>
                  <div class="sidebar-project-list">
                    <button
                      type="button"
                      class="sidebar-project-option"
                      :class="{ 'is-selected': !sessionSelectedWorkspaceId }"
                      @click="selectProject(null)"
                    >
                      <span class="sidebar-project-option-copy">
                        <span class="sidebar-project-option-name">{{ t('chat.workspace.noWorkspace') }}</span>
                      </span>
                      <Check
                        v-if="!sessionSelectedWorkspaceId"
                        class="sidebar-project-option-check"
                        :size="14"
                      />
                    </button>
                    <div v-if="switchableWorkspaces.length === 0" class="sidebar-project-empty">
                      {{ t('chat.workspace.noneVisible') }}
                    </div>
                    <button
                      v-for="workspace in switchableWorkspaces"
                      :key="workspace.id"
                      type="button"
                      class="sidebar-project-option"
                      :class="{ 'is-selected': sessionSelectedWorkspaceId === workspace.id }"
                      @click="selectProject(workspace.id)"
                    >
                      <span class="sidebar-project-option-copy">
                        <span class="sidebar-project-option-name">{{ workspace.name }}</span>
                        <span class="sidebar-project-option-path">{{ workspace.path }}</span>
                      </span>
                      <Check
                        v-if="sessionSelectedWorkspaceId === workspace.id"
                        class="sidebar-project-option-check"
                        :size="14"
                      />
                    </button>
                  </div>
                </PopoverContent>
              </PopoverPortal>
            </PopoverRoot>
          </div>
          <template v-if="section.name === null || !collapsedGroups[section.key]">
            <div
              v-for="chat in visibleThreadsFor(section)"
              :key="chat.id"
              class="chat-item-row group relative"
              :class="{ 'chat-item-row--grouped': section.name !== null }"
            >
              <button
                class="chat-item flex h-8 w-full items-center rounded-lg px-2.5 pr-16 text-left text-[13px] leading-5"
                :class="{ 'chat-item-active': currentThreadId === chat.id }"
                :title="chat.title"
                @click="selectThread(chat.id)"
              >
                <span class="chat-item-title">{{ chat.title }}</span>
              </button>
              <span
                v-if="formatRelativeTime(chat.updated_at)"
                class="chat-item-time"
              >{{ formatRelativeTime(chat.updated_at) }}</span>
              <span
                v-if="chat.is_generating"
                class="chat-item-dot"
                :title="t('chat.sidebar.running')"
              />
              <button
                class="chat-export-btn"
                :aria-label="t('chat.sidebar.exportChat')"
                :title="t('chat.sidebar.exportChat')"
                @click="handleExportThread(chat, $event)"
              >
                <Download :size="14" />
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
            <button
              v-if="section.threads.length > visibleThreadLimitFor(section)"
              type="button"
              class="sidebar-show-more"
              @click="toggleSectionExpanded(section.key)"
            >
              {{
                expandedSections.has(section.key)
                  ? t('chat.sidebar.showLess')
                  : t('chat.sidebar.showMore', {
                      count: section.threads.length - visibleThreadLimitFor(section),
                    })
              }}
            </button>
          </template>
        </template>

        <section v-if="shouldShowExternalSection" class="sidebar-section">
          <div v-if="threadSections.length > 0" class="sidebar-section-divider"></div>
          <div class="sidebar-section-header">
            <span>{{ t('chat.sidebar.externalChats') }}</span>
            <span class="sidebar-section-count">{{ externalThreads.length }}</span>
          </div>

          <div
            v-for="chat in externalThreads"
            :key="chat.id"
            class="chat-item-row chat-item-row-external"
          >
            <button
              class="chat-item chat-item-external w-full rounded-lg px-3 py-2 text-left text-[13px] leading-5"
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

        <template v-if="isSearchOpen && searchQuery.trim()">
          <div
            v-if="contentMatches.length > 0"
            class="sidebar-section"
          >
            <div class="sidebar-section-divider"></div>
            <div class="sidebar-section-header">
              <span>{{ t('chat.sidebar.messageMatches') }}</span>
              <span class="sidebar-section-count">{{ contentMatches.length }}</span>
            </div>
            <button
              v-for="match in contentMatches"
              :key="match.messageId"
              class="chat-item chat-message-match w-full rounded-lg px-3 py-2 text-left text-[13px] leading-5"
              :title="match.snippet"
              @click="selectThread(match.threadId)"
            >
              <span class="chat-item-title">{{ match.threadTitle }}</span>
              <span class="chat-message-match-snippet">{{ match.snippet }}</span>
            </button>
          </div>

          <div
            v-if="threadSections.every(section => section.threads.length === 0) && contentMatches.length === 0"
            class="sidebar-no-results"
          >
            {{ t('chat.sidebar.noResults') }}
          </div>
        </template>
      </div>

      <!-- Sidebar Footer -->
      <div class="relative p-3 mt-auto flex">
        <DropdownMenuRoot :modal="false">
          <DropdownMenuTrigger
            as-child
            :aria-label="t('chat.sidebar.menu')"
          >
            <button
              class="sidebar-menu-btn icon-btn ui-text-secondary flex h-8 w-8 items-center justify-center rounded-lg"
            >
              <MoreHorizontal :size="18" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuPortal>
            <DropdownMenuContent
              class="sidebar-menu"
              :side-offset="8"
              align="start"
              side="top"
            >
              <DropdownMenuItem
                class="sidebar-menu-item"
                @select="handleOpenSettings"
              >
                <span class="sidebar-menu-item-icon">
                  <Settings2 :size="14" />
                </span>
                <span class="sidebar-menu-item-label text-sm">{{ t('chat.welcome.settings') }}</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator class="sidebar-menu-divider" />
              <DropdownMenuCheckboxItem
                class="sidebar-menu-item"
                :model-value="sidebar.showExternalChats.value"
                @update:model-value="toggleExternalChats"
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
              </DropdownMenuCheckboxItem>
            </DropdownMenuContent>
          </DropdownMenuPortal>
        </DropdownMenuRoot>
      </div>

      <!-- draggable handle -->
      <div
        class="resize-handle absolute top-0 right-0 z-10 h-full w-1 cursor-col-resize transition-colors group"
        @mousedown="startResize"
        @touchstart="startResize"
      >
        <div
          class="resize-handle-indicator absolute top-1/2 left-1/2 h-8 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full opacity-0 transition-opacity group-hover:opacity-100"
        ></div>
      </div>
    </template>
  </div>


</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import {
  AlarmClock,
  ArrowLeftRight,
  Check,
  ChevronDown,
  Download,
  Folder,
  FolderPlus,
  Hash,
  MessageSquareShare,
  MoreHorizontal,
  PanelLeftDashed,
  Search,
  Settings2,
  SquarePen,
  Trash2,
  X,
} from '@lucide/vue';
import { createLogger } from '../logger';
import { translate, useI18n } from '../i18n';
import {
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuRoot,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  PopoverContent,
  PopoverPortal,
  PopoverRoot,
  PopoverTrigger,
} from 'reka-ui';
import { storeToRefs } from 'pinia';
import { useThreadSessionStore } from '../store/thread_session';
import { useSidebar } from '../composables/useSidebar';
import { useSidebarData, type SidebarChatThread } from '../composables/useSidebarData';
import { useSidebarSearch } from '../composables/useSidebarSearch';
import { useSidebarThreadSections } from '../composables/useSidebarThreadSections';
import { confirmAction } from '../composables/useConfirm';
import { getThreadOriginInfo, isExternalThread } from '../modules/chat/thread_origin';
import { formatRelativeTime as formatRelativeTimeIso } from '../utils/formatters';
import {
  getElectronApiSlice,
  getElectronApiSliceMethod,
} from '../services/electron_api';

type ChatThread = SidebarChatThread;

const sidebar = useSidebar();
const threadSession = useThreadSessionStore();
const { selectedWorkspaceId: sessionSelectedWorkspaceId } = storeToRefs(threadSession);
const { t } = useI18n();
const sidebarLogger = createLogger({ module: 'sidebar' });

const SIDEBAR_TRANSITION_MS = 320;
const contentVisible = ref(sidebar.isExpanded.value);
let contentHideTimer: ReturnType<typeof setTimeout> | null = null;
watch(
  () => sidebar.isExpanded.value,
  expanded => {
    if (contentHideTimer) {
      clearTimeout(contentHideTimer);
      contentHideTimer = null;
    }
    if (expanded) {
      contentVisible.value = true;
      return;
    }
    contentHideTimer = setTimeout(() => {
      contentVisible.value = false;
    }, SIDEBAR_TRANSITION_MS);
  },
);
onBeforeUnmount(() => {
  if (contentHideTimer) {
    clearTimeout(contentHideTimer);
  }
});

const isResizing = ref(false);

const chatApi = getElectronApiSlice('chat');
const workspacesApi = getElectronApiSlice('workspaces');
const pickWorkspaceDirectory = getElectronApiSliceMethod('workspaces', 'pickDirectory');

const { chatThreads, workspaces, loadChatThreads } = useSidebarData({ chatApi, workspacesApi });
const {
  isSearchOpen,
  searchQuery,
  searchInputRef,
  contentMatches,
  toggleSearch,
  clearSearch,
  closeSearch,
  matchesSearch,
} = useSidebarSearch({ searchContent: chatApi?.threads?.searchContent });
const {
  groupMode,
  setGroupMode,
  collapsedGroups,
  expandedSections,
  threadSections,
  visibleThreadLimitFor,
  visibleThreadsFor,
  toggleSectionExpanded,
  toggleGroupCollapsed,
} = useSidebarThreadSections({
  chatThreads: () => chatThreads.value,
  workspaces: () => workspaces.value,
  matchesSearch,
});

const currentThreadId = computed(() => threadSession.currentThread?.id ?? null);
const deletingThreadIds = ref<Record<string, boolean>>({});

const props = defineProps<{
  workspaceLocked?: boolean;
  
  hideCollapsedToolbar?: boolean;
}>();

const emit = defineEmits<{
  'thread-selected': [threadId: string];
  'new-chat': [];
  'new-work': [workspaceId: string];
  'thread-deleted': [threadId: string];
}>();

const selectThread = (threadId: string) => {
  emit('thread-selected', threadId);
};

const handleNewChat = () => {
  emit('new-chat');
};

const handleNewWork = async () => {
  if (typeof pickWorkspaceDirectory !== 'function') return;
  try {
    const workspace = (await pickWorkspaceDirectory()) as { id?: string } | null;
    if (!workspace?.id) return;
    emit('new-work', workspace.id);
  } catch (error) {
    sidebarLogger.event({
      level: 'warn',
      event: 'chat.workspaces.pick',
      outcome: 'failed',
      error,
    });
  }
};

const projectSwitcherSection = ref<string | null>(null);
const isPickingProjectDirectory = ref(false);

const switchableWorkspaces = computed(() =>
  workspaces.value.filter(
    workspace => !workspace.is_temporary && workspace.show_in_list
  )
);

const handleProjectSwitcherOpen = (sectionKey: string, open: boolean) => {
  projectSwitcherSection.value = open ? sectionKey : null;
  if (open) void loadChatThreads();
};

const selectProject = (workspaceId: string | null) => {
  void threadSession.setWorkspace(workspaceId);
  projectSwitcherSection.value = null;
};

const pickProjectDirectory = async () => {
  if (typeof pickWorkspaceDirectory !== 'function') return;
  isPickingProjectDirectory.value = true;
  try {
    const workspace = (await pickWorkspaceDirectory()) as { id?: string } | null;
    if (workspace?.id) {
      void threadSession.setWorkspace(workspace.id);
      projectSwitcherSection.value = null;
    }
    void loadChatThreads();
  } catch (error) {
    sidebarLogger.event({
      level: 'warn',
      event: 'chat.workspaces.pick',
      outcome: 'failed',
      error,
    });
  } finally {
    isPickingProjectDirectory.value = false;
  }
};

const handleExportThread = async (thread: ChatThread, event: MouseEvent) => {
  event.preventDefault();
  event.stopPropagation();

  if (!chatApi?.threads?.exportMarkdown) return;
  try {
    const result = await chatApi.threads.exportMarkdown(thread.id);
    if (result?.success === false && result.error && result.error !== 'cancelled') {
      sidebarLogger.event({
        level: 'warn',
        event: 'chat.thread.export',
        outcome: 'failed',
        message: result.error,
        entity: { thread_id: thread.id },
      });
    }
  } catch (error) {
    sidebarLogger.event({
      level: 'error',
      event: 'chat.thread.export',
      outcome: 'failed',
      error,
      entity: { thread_id: thread.id },
    });
  }
};

const handleDeleteThread = async (thread: ChatThread, event: MouseEvent) => {
  event.preventDefault();
  event.stopPropagation();

  if (deletingThreadIds.value[thread.id]) return;

  const confirmed = await confirmAction({
    message: t('chat.sidebar.deleteConfirm', { title: thread.title }),
    danger: true,
  });
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

const formatRelativeTime = (iso: string): string => formatRelativeTimeIso(iso, translate);

const openAutomations = () => {
  window.location.hash = 'settings/tasks';
};

const externalThreads = computed(() =>
  chatThreads.value.filter(thread => isExternalThread(thread) && matchesSearch(thread))
);
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

const handleOpenSettings = () => {
  openSettings();
};

const toggleExternalChats = () => {
  sidebar.toggleExternalChats();
};

watch(
  () => threadSession.threadListRevision,

  () => {
    void loadChatThreads();
  }
);

onMounted(() => {
  loadChatThreads();
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
  isResizing.value = true;

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
    isResizing.value = false;
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', handleEnd);
    document.removeEventListener('touchmove', handleTouchMove);
    document.removeEventListener('touchend', handleEnd);
  };

  document.addEventListener('mousemove', handleMouseMove);
  document.addEventListener('mouseup', handleEnd);
  document.addEventListener('touchmove', handleTouchMove, {
    passive: false,
  });
  document.addEventListener('touchend', handleEnd);
};

const openSettings = () => {
  window.location.hash = 'settings';
};
</script>
<style scoped src="./sidebar.css"></style>
