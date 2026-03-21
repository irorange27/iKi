import { ref } from 'vue';

import { getToolName } from '../modules/chat/ui_message_tool_parts';
import type { ElectronApi } from '../../shared/types/electron_api';

type ToolSource = {
  kind?: 'builtin' | 'mcp';
  id?: string;
  name?: string;
};

export const useToolMetadata = (deps: {
  electronAPI: Pick<ElectronApi, 'tools' | 'skills'>;
}) => {
  const toolSourceMap = ref<Map<string, ToolSource>>(new Map());
  const toolSourceLoading = ref(false);

  const loadToolSources = async () => {
    if (toolSourceLoading.value) return;
    toolSourceLoading.value = true;
    try {
      if (!deps.electronAPI?.tools?.list) return;
      const list = await deps.electronAPI.tools.list();
      if (!Array.isArray(list)) return;
      const next = new Map<string, ToolSource>();
      for (const item of list) {
        if (!item || typeof item !== 'object') continue;
        const name = (item as { name?: unknown }).name;
        if (typeof name !== 'string' || !name.trim()) continue;
        const source = (item as { source?: unknown }).source;
        if (source && typeof source === 'object') {
          next.set(name, source as ToolSource);
        }
      }
      toolSourceMap.value = next;
    } catch (error) {
      console.warn('Failed to load tool metadata:', error);
    } finally {
      toolSourceLoading.value = false;
    }
  };

  const getMcpServerLabel = (part: unknown): string => {
    const toolName = getToolName(part);
    if (!toolName) return '';
    const source = toolSourceMap.value.get(toolName);
    if (!source && (toolName.startsWith('mcp_') || toolName.startsWith('mcp:'))) {
      void loadToolSources();
    }
    if (source?.kind !== 'mcp') return '';
    return source.name || source.id || '';
  };

  const openSkillReference = async (skillId: string) => {
    try {
      const result = await deps.electronAPI?.skills?.openSkill?.(skillId);
      if (result?.success) return;
      console.warn('Failed to open skill:', result?.error || skillId);
    } catch (error) {
      console.warn('Failed to open skill:', error);
    }
  };

  return {
    loadToolSources,
    getMcpServerLabel,
    openSkillReference,
  };
};
