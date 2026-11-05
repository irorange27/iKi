import { computed, ref } from 'vue';
import { resolveThreadWorkMode } from '@iki/backend/workspaces/thread_mode';
import { isExternalThread } from '../modules/chat/thread_origin';
import type { WorkspaceInfo, SidebarChatThread } from './useSidebarData';

export type SidebarThreadSection = {
  key: string;

  name: string | null;
  threads: SidebarChatThread[];
};

const GROUP_MODE_STORAGE_KEY = 'iki-sidebar-group-mode';
const VISIBLE_DEFAULT_THREADS = 10;
const VISIBLE_PROJECT_THREADS = 5;

/**
 * Thread grouping for the sidebar: time mode (one flat list) vs projects mode
 * (work threads bucketed by workspace), plus per-section expansion state and
 * the default visible-thread caps.
 */
export const useSidebarThreadSections = (deps: {
  chatThreads: () => SidebarChatThread[];
  workspaces: () => WorkspaceInfo[];
  matchesSearch: (thread: SidebarChatThread) => boolean;
}) => {
  const groupMode = ref<'time' | 'projects'>(
    localStorage.getItem(GROUP_MODE_STORAGE_KEY) === 'projects' ? 'projects' : 'time'
  );
  const collapsedGroups = ref<Record<string, boolean>>({});
  const expandedSections = ref<Set<string>>(new Set());

  const setGroupMode = (mode: 'time' | 'projects') => {
    groupMode.value = mode;
    localStorage.setItem(GROUP_MODE_STORAGE_KEY, mode);
  };

  const getThreadWorkspaceId = (thread: SidebarChatThread): string =>
    typeof thread.workspace_id === 'string' ? thread.workspace_id : '';

  const workspaceNameById = computed(() => {
    const names = new Map<string, string>();
    for (const workspace of deps.workspaces()) {
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

  const isUserWorkspace = (workspaceId: string): boolean => {
    const workspace = deps.workspaces().find(candidate => candidate.id === workspaceId);
    return Boolean(workspace) && !workspace!.is_temporary;
  };

  const isWorkThread = (thread: SidebarChatThread): boolean =>
    resolveThreadWorkMode(thread) === 'work';

  const threadSections = computed<SidebarThreadSection[]>(() => {
    const visibleDesktopThreads = deps.chatThreads().filter(
      thread => !isExternalThread(thread) && deps.matchesSearch(thread)
    );
    const sections: SidebarThreadSection[] = [];

    if (groupMode.value === 'time') {
      sections.push({ key: 'chats', name: null, threads: visibleDesktopThreads });
      return sections;
    }

    const isolatedWork = visibleDesktopThreads.filter(thread => {
      if (!isWorkThread(thread)) return false;
      const workspaceId = getThreadWorkspaceId(thread);
      return !workspaceId || !isUserWorkspace(workspaceId);
    });
    sections.push({ key: 'chats', name: null, threads: isolatedWork });

    const byWorkspace = new Map<string, SidebarChatThread[]>();
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

  const visibleThreadLimitFor = (section: { key: string; name: string | null }): number =>
    section.name === null ? VISIBLE_DEFAULT_THREADS : VISIBLE_PROJECT_THREADS;

  const visibleThreadsFor = (section: SidebarThreadSection): SidebarChatThread[] => {
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

  const toggleGroupCollapsed = (key: string) => {
    collapsedGroups.value = {
      ...collapsedGroups.value,
      [key]: !collapsedGroups.value[key],
    };
  };

  return {
    groupMode,
    setGroupMode,
    collapsedGroups,
    expandedSections,
    threadSections,
    visibleThreadLimitFor,
    visibleThreadsFor,
    toggleSectionExpanded,
    toggleGroupCollapsed,
  };
};
