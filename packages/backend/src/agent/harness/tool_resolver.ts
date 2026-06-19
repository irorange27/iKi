import { createLogger } from '@iki/core/logger';
import { defaultToolRegistry } from '@iki/core/tools';
import { LoadSkillTool } from '@iki/backend/tools/skill_tools';
import { applyToolApprovalPolicy } from '@iki/core/utils/tool_approval';
import { getAppConfig } from '@iki/core/context/config_provider';
import type { AgentTool } from '@iki/core/agent/types';

const logger = createLogger({ module: 'tool_resolver' });

const GUARD_BYPASS_TOOLS = new Set(['handoff', 'plan', 'todo']);

const getEmotionConfig = () => getAppConfig()?.memory?.emotion ?? null;

const shouldAutoApproveToolRequests = () =>
  getAppConfig()?.general?.autoApproveToolRequests === true;

const prepareToolWithGuard = (
  toolName: string,
  guardActive: boolean,
): AgentTool | null => {
  const tool = defaultToolRegistry.get(toolName);
  if (!tool) return null;

  const emotionConfig = getEmotionConfig();
  const requireApproval = guardActive && Boolean(emotionConfig?.toolGuard?.requireApproval);

  let resolved = tool;
  if (requireApproval) {
    resolved = { ...tool, needsApproval: true };
  } else if (!guardActive && tool.approvalMode !== 'always') {
    resolved = { ...tool, needsApproval: false };
  }

  return applyToolApprovalPolicy(resolved, {
    autoApproveToolRequests: shouldAutoApproveToolRequests(),
  });
};

export const resolveTools = (params: {
  enableTools: boolean;
  enabledToolNames: string[];
  availableSkillIds: string[];
  guardActive: boolean;
}): AgentTool[] => {
  if (!params.enableTools) return [];

  const resolvedTools: AgentTool[] = [];

  for (const toolName of GUARD_BYPASS_TOOLS) {
    const tool = defaultToolRegistry.get(toolName);
    if (tool) resolvedTools.push(tool);
  }

  if (params.availableSkillIds.length > 0) {
    const loadSkill = new LoadSkillTool().toAgentTool();
    resolvedTools.push(loadSkill);
  }

  for (const toolName of params.enabledToolNames) {
    if (GUARD_BYPASS_TOOLS.has(toolName) || toolName === 'load_skill') continue;
    if (!defaultToolRegistry.get(toolName)) {
      logger.warn(`Tool ${toolName} not found in registry`);
      continue;
    }
    const registered = prepareToolWithGuard(toolName, params.guardActive);
    if (registered) {
      resolvedTools.push(registered);
    }
  }

  return resolvedTools;
};
