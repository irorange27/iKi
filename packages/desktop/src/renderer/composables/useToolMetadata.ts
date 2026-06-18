import { ref } from 'vue';

import { getToolName } from '../modules/chat/ui_message_tool_parts';
import type { ElectronApi } from '@iki/core/types/electron_api';
import { createLogger } from '../logger';

type ToolSource = {
  kind?: 'builtin' | 'mcp';
  id?: string;
  name?: string;
};

const toolMetadataLogger = createLogger({ module: 'tool_metadata' });

export const useToolMetadata = (deps: {
  electronAPI: Pick<ElectronApi, 'tools' | 'skills'>;
}) => {
  const listTools = deps.electronAPI.tools?.list;
  const openSkill = deps.electronAPI.skills?.openSkill;
  const toolSourceMap = ref<Map<string, ToolSource>>(new Map());
  const toolSourceLoading = ref(false);

  const loadToolSources = async () => {
    if (toolSourceLoading.value) return;
    toolSourceLoading.value = true;
    try {
      if (!listTools) return;
      const list = await listTools();
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
      toolMetadataLogger.event({
        level: 'warn',
        event: 'tools.metadata.load',
        outcome: 'failed',
        error,
      });
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
      const result = openSkill ? await openSkill(skillId) : null;
      if (result?.success) return;
      toolMetadataLogger.event({
        level: 'warn',
        event: 'skills.open',
        outcome: 'failed',
        message: typeof result?.error === 'string' ? result.error : 'Failed to open skill.',
        entity: {
          skill_id: skillId,
        },
      });
    } catch (error) {
      toolMetadataLogger.event({
        level: 'warn',
        event: 'skills.open',
        outcome: 'failed',
        error,
        entity: {
          skill_id: skillId,
        },
      });
    }
  };

  return {
    loadToolSources,
    getMcpServerLabel,
    openSkillReference,
  };
};
