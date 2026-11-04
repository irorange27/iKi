import { ref } from 'vue';
import { createLogger } from '../logger';

const sidebarDataLogger = createLogger({ module: 'sidebar' });

export type WorkspaceInfo = {
  id: string;
  name: string;
  path: string;
  is_temporary?: number;
  show_in_list?: number;
};

export type SidebarChatThread = {
  id: string;
  title: string;
  model?: string;
  updated_at: string;
  client_id?: string;
  workspace_id?: string;
  is_generating?: number | boolean;
  metadata: string;
};

type ChatApi = {
  threads?: {
    list?: () => Promise<unknown>;
  };
};
type WorkspacesApi = {
  list?: () => Promise<unknown>;
};

/**
 * Sidebar data loading: workspaces + chat threads with a generation guard so a
 * slow earlier response can never overwrite a newer one.
 */
export const useSidebarData = (deps: {
  chatApi: ChatApi | null;
  workspacesApi: WorkspacesApi | null;
}) => {
  const { chatApi, workspacesApi } = deps;

  const chatThreads = ref<SidebarChatThread[]>([]);
  const workspaces = ref<WorkspaceInfo[]>([]);

  let threadLoadGeneration = 0;
  const loadChatThreads = async () => {
    const generation = ++threadLoadGeneration;
    if (workspacesApi?.list) {
      try {
        const list = await workspacesApi.list();
        if (generation !== threadLoadGeneration) return;
        workspaces.value = Array.isArray(list) ? (list as WorkspaceInfo[]) : [];
      } catch (error) {
        sidebarDataLogger.event({
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
      if (generation !== threadLoadGeneration) return;
      chatThreads.value = Array.isArray(threads) ? (threads as SidebarChatThread[]) : [];
    } catch (error) {
      sidebarDataLogger.event({
        level: 'error',
        event: 'chat.threads.load',
        outcome: 'failed',
        error,
      });
    }
  };

  return { chatThreads, workspaces, loadChatThreads };
};
