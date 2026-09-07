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
    <!-- Collapsed: fixed mini toolbar in the top-left corner -->
    <div
      v-if="sidebar.isCollapsed.value"
      class="toolbar-container fixed top-4 left-20 z-[var(--z-chrome)] flex items-center gap-1 transition-all duration-300"
    >
      <button class="sidebar-tool-btn icon-btn" @click="sidebar.toggle" :aria-label="t('chat.sidebar.toggle')">
        <PanelLeftDashed :size="18" />
      </button>
      <button class="sidebar-tool-btn icon-btn" :aria-label="t('chat.sidebar.newChat')" @click="handleNewChat">
        <SquarePen :size="18" />
      </button>
    </div>

    <template v-if="sidebar.isExpanded.value">
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
          <button
            v-if="section.name !== null"
            type="button"
            class="sidebar-section-header sidebar-section-toggle"
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
            <span class="sidebar-section-count">{{ section.threads.length }}</span>
          </button>
          <template v-if="section.name === null || !collapsedGroups[section.key]">
            <div
              v-for="chat in visibleThreadsFor(section)"
              :key="chat.id"
              class="chat-item-row group relative"
              :class="{ 'chat-item-row--grouped': section.name !== null }"
            >
              <button
                class="chat-item w-full truncate rounded-lg px-3 py-2 pr-16 text-left text-[13px] leading-5 focus:outline-none"
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
                  : t('chat.sidebar.showMore', { count: section.threads.length - visibleThreadLimitFor(section) })
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
              class="chat-item chat-item-external w-full rounded-lg px-3 py-2 text-left text-[13px] leading-5 focus:outline-none"
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
              class="chat-item chat-message-match w-full rounded-lg px-3 py-2 text-left text-[13px] leading-5 focus:outline-none"
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
                class="sidebar-menu-item sidebar-menu-item-settings"
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
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import {
  AlarmClock,
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
} from 'lucide-vue-next';
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
} from 'reka-ui';
import { resolveThreadWorkMode } from '@iki/backend/workspaces/thread_mode';
import type { ThreadContentMatch } from '@iki/backend/chat/thread_content_search';
import { useSidebar } from '../composables/useSidebar';
import { confirmAction } from '../composables/useConfirm';
import { getThreadOriginInfo, isExternalThread } from '../modules/chat/thread_origin';
import { getElectronApiMethod, getElectronApiSlice, getElectronApiSliceMethod } from '../services/electron_api';

const sidebar = useSidebar();
const { t } = useI18n();
const sidebarLogger = createLogger({ module: 'sidebar' });

interface ChatThread {
  id: string;
  title: string;
  model?: string;
  updated_at: string;
  client_id?: string;
  workspace_id?: string;
  is_generating?: number | boolean;
  metadata: string;
}

interface WorkspaceInfo {
  id: string;
  name: string;
  path: string;
  is_temporary?: number;
}

const chatApi = getElectronApiSlice('chat');
const workspacesApi = getElectronApiSlice('workspaces');
const pickWorkspaceDirectory = getElectronApiSliceMethod('workspaces', 'pickDirectory');
const openSettingsWindow = getElectronApiMethod('openSettings');

const chatThreads = ref<ChatThread[]>([]);
const workspaces = ref<WorkspaceInfo[]>([]);
const currentThreadId = ref<string | null>(null);
const deletingThreadIds = ref<Record<string, boolean>>({});
const collapsedGroups = ref<Record<string, boolean>>({});
const expandedSections = ref<Set<string>>(new Set());

// Sidebar grouping modes (Codex-style): flat by recency, or projects only.
const GROUP_MODE_STORAGE_KEY = 'iki-sidebar-group-mode';
const groupMode = ref<'time' | 'projects'>(
  localStorage.getItem(GROUP_MODE_STORAGE_KEY) === 'projects' ? 'projects' : 'time'
);
const setGroupMode = (mode: 'time' | 'projects') => {
  groupMode.value = mode;
  localStorage.setItem(GROUP_MODE_STORAGE_KEY, mode);
};
const isSearchOpen = ref(false);
const searchQuery = ref('');
const searchInputRef = ref<HTMLInputElement | null>(null);
const contentMatches = ref<ThreadContentMatch[]>([]);
let contentSearchTimer: ReturnType<typeof setTimeout> | null = null;
const menuPosition = ref({
  left: 0,
  bottom: 0,
});
let menuCloseTimer: ReturnType<typeof setTimeout> | null = null;

// Emit events to parent
const emit = defineEmits<{
  'thread-selected': [threadId: string];
  'new-chat': [];
  'new-work': [workspaceId: string];
  'thread-deleted': [threadId: string];
}>();

// Load chat threads from database
const loadChatThreads = async () => {
  if (workspacesApi?.list) {
    try {
      const list = await workspacesApi.list();
      workspaces.value = Array.isArray(list) ? (list as WorkspaceInfo[]) : [];
    } catch (error) {
      sidebarLogger.event({
        level: 'warn',
        event: 'chat.workspaces.load',
        outcome: 'failed',
        error,
      });
    }
  }
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

const toggleSearch = () => {
  if (isSearchOpen.value) {
    closeSearch();
    return;
  }
  isSearchOpen.value = true;
  nextTick(() => searchInputRef.value?.focus());
};

const clearSearch = () => {
  searchQuery.value = '';
  contentMatches.value = [];
  searchInputRef.value?.focus();
};

watch(searchQuery, query => {
  if (contentSearchTimer) clearTimeout(contentSearchTimer);
  if (!query.trim()) {
    contentMatches.value = [];
    return;
  }
  contentSearchTimer = setTimeout(() => {
    contentSearchTimer = null;
    void runContentSearch(query);
  }, 280);
});

const closeSearch = () => {
  isSearchOpen.value = false;
  searchQuery.value = '';
};

// Handle new chat button
const handleNewChat = () => {
  currentThreadId.value = null;
  emit('new-chat');
};

// New work task: pick a project folder first, then create the bound thread.
const handleNewWork = async () => {
  if (typeof pickWorkspaceDirectory !== 'function') return;
  try {
    const workspace = (await pickWorkspaceDirectory()) as { id?: string } | null;
    if (!workspace?.id) return;
    currentThreadId.value = null;
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

const runContentSearch = async (query: string) => {
  const searchContent = chatApi?.threads?.searchContent;
  if (typeof searchContent !== 'function' || !query.trim()) {
    contentMatches.value = [];
    return;
  }
  try {
    const matches = (await searchContent(query.trim())) as ThreadContentMatch[];
    contentMatches.value = Array.isArray(matches)
      ? matches.filter(match => !isExternalThread(match as never))
      : [];
  } catch (error) {
    sidebarLogger.event({
      level: 'warn',
      event: 'chat.search.content',
      outcome: 'failed',
      error,
    });
    contentMatches.value = [];
  }
};

const matchesSearch = (thread: ChatThread) => {
  const query = searchQuery.value.trim().toLowerCase();
  if (!query) return true;
  return thread.title.toLowerCase().includes(query);
};

const getThreadWorkspaceId = (thread: ChatThread): string =>
  typeof thread.workspace_id === 'string' ? thread.workspace_id : '';

const workspaceNameById = computed(() => {
  const names = new Map<string, string>();
  for (const workspace of workspaces.value) {
    const name =
      typeof workspace.name === 'string' && workspace.name.trim()
        ? workspace.name.trim()
        : (workspace.path.split(/[\\/]/).filter(Boolean).pop() ?? workspace.id);
    names.set(workspace.id, name);
  }
  return names;
});

const getWorkspaceDisplayName = (workspaceId: string): string =>
  workspaceNameById.value.get(workspaceId) ?? workspaceId;

/**
 * Only user-added workspaces act as "projects" in the sidebar. Threads bound
 * to a scratch (`is_temporary`) or worktree workspace are thread-private —
 * grouping them would flood the list with one identically-named section per
 * thread, so they stay in the default list.
 */
const isUserWorkspace = (workspaceId: string): boolean => {
  const workspace = workspaces.value.find(candidate => candidate.id === workspaceId);
  return Boolean(workspace) && workspace!.is_temporary !== 1;
};

const isWorkThread = (thread: ChatThread): boolean =>
  resolveThreadWorkMode(thread) === 'work';

type SidebarThreadSection = {
  key: string;
  /** null for the default ungrouped section (no header rendered). */
  name: string | null;
  threads: ChatThread[];
};

const threadSections = computed<SidebarThreadSection[]>(() => {
  const visibleDesktopThreads = chatThreads.value.filter(
    thread => !isExternalThread(thread) && matchesSearch(thread)
  );
  const sections: SidebarThreadSection[] = [];

  if (groupMode.value === 'time') {
    sections.push({ key: 'chats', name: null, threads: visibleDesktopThreads });
    return sections;
  }

  // Projects view: work threads bound to a user workspace group under their
  // project; worktree-isolated tasks (no project behind them) stay flat.
  // Plain chats are hidden here — that is what the recent view is for.
  const isolatedWork = visibleDesktopThreads.filter(thread => {
    if (!isWorkThread(thread)) return false;
    const workspaceId = getThreadWorkspaceId(thread);
    return !workspaceId || !isUserWorkspace(workspaceId);
  });
  sections.push({ key: 'chats', name: null, threads: isolatedWork });

  const byWorkspace = new Map<string, ChatThread[]>();
  for (const thread of visibleDesktopThreads) {
    const workspaceId = getThreadWorkspaceId(thread);
    if (!workspaceId || !isUserWorkspace(workspaceId) || !isWorkThread(thread)) continue;
    const group = byWorkspace.get(workspaceId);
    if (group) {
      group.push(thread);
    } else {
      byWorkspace.set(workspaceId, [thread]);
    }
  }

  const workspaceIds = [...byWorkspace.keys()].sort((a, b) =>
    getWorkspaceDisplayName(a).localeCompare(getWorkspaceDisplayName(b))
  );
  for (const workspaceId of workspaceIds) {
    sections.push({
      key: `workspace:${workspaceId}`,
      name: getWorkspaceDisplayName(workspaceId),
      threads: byWorkspace.get(workspaceId)!,
    });
  }

  return sections;
});

const VISIBLE_DEFAULT_THREADS = 10;
const VISIBLE_PROJECT_THREADS = 5;

const visibleThreadLimitFor = (section: { key: string; name: string | null }): number =>
  section.name === null ? VISIBLE_DEFAULT_THREADS : VISIBLE_PROJECT_THREADS;

const visibleThreadsFor = (section: { key: string; name: string | null; threads: ChatThread[] }): ChatThread[] => {
  const limit = visibleThreadLimitFor(section);
  if (expandedSections.value.has(section.key)) return section.threads;
  return section.threads.slice(0, limit);
};

const toggleSectionExpanded = (key: string) => {
  const next = new Set(expandedSections.value);
  if (next.has(key)) {
    next.delete(key);
  } else {
    next.add(key);
  }
  expandedSections.value = next;
};

const formatRelativeTime = (iso: string): string => {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return '';
  const diff = Date.now() - time;
  const MINUTE = 60_000;
  const HOUR = 60 * MINUTE;
  const DAY = 24 * HOUR;
  if (diff < MINUTE) return translate('time.justNow');
  if (diff < HOUR) return translate('time.minutes', { count: Math.floor(diff / MINUTE) });
  if (diff < DAY) return translate('time.hours', { count: Math.floor(diff / HOUR) });
  if (diff < 7 * DAY) return translate('time.days', { count: Math.floor(diff / DAY) });
  return new Date(time).toLocaleDateString();
};

const openAutomations = () => {
  openSettingsWindow?.('tasks');
};

const toggleGroupCollapsed = (key: string) => {
  collapsedGroups.value = {
    ...collapsedGroups.value,
    [key]: !collapsedGroups.value[key],
  };
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

// Expose refresh function for parent
defineExpose({
  refresh: loadChatThreads,
  setCurrentThread: (id: string | null) => {
    currentThreadId.value = id;
  },
});

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
