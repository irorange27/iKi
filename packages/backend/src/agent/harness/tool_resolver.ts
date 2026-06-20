import { createLogger } from '@iki/backend/logger';
import { defaultToolRegistry } from '@iki/backend/tools';
import { LoadSkillTool } from '@iki/backend/tools/skill_tools';
import { applyToolApprovalPolicy } from '@iki/backend/utils/tool_approval';
import type { AgentTool } from '@iki/backend/agent/types';

const logger = createLogger({ module: 'tool_resolver' });

const GUARD_BYPASS_TOOLS = new Set(['handoff', 'plan', 'todo']);

const prepareToolWithGuard = (
  toolName: string,
  guardActive: boolean,
  requireApproval: boolean,
  autoApproveToolRequests: boolean,
): AgentTool | null => {
  const tool = defaultToolRegistry.get(toolName);
  if (!tool) return null;

  let resolved = tool;
  if (requireApproval) {
    resolved = { ...tool, needsApproval: true };
  } else if (!guardActive && tool.approvalMode !== 'always') {
    resolved = { ...tool, needsApproval: false };
  }

  return applyToolApprovalPolicy(resolved, { autoApproveToolRequests });
};

export const resolveTools = (params: {
  enableTools: boolean;
  enabledToolNames: string[];
  availableSkillIds: string[];
  guardActive: boolean;
  requireApproval: boolean;
  autoApproveToolRequests: boolean;
  skillToolFactory?: () => AgentTool;
}): AgentTool[] => {
  if (!params.enableTools) return [];

  const resolvedTools: AgentTool[] = [];

  for (const toolName of GUARD_BYPASS_TOOLS) {
    const tool = defaultToolRegistry.get(toolName);
    if (tool) resolvedTools.push(tool);
  }

  if (params.availableSkillIds.length > 0) {
    const factory = params.skillToolFactory ?? (() => new LoadSkillTool().toAgentTool());
    resolvedTools.push(factory());
  }

  for (const toolName of params.enabledToolNames) {
    if (GUARD_BYPASS_TOOLS.has(toolName) || toolName === 'load_skill') continue;
    if (!defaultToolRegistry.get(toolName)) {
      logger.warn(`Tool ${toolName} not found in registry`);
      continue;
    }
    const registered = prepareToolWithGuard(
      toolName,
      params.guardActive,
      params.requireApproval,
      params.autoApproveToolRequests,
    );
    if (registered) {
      resolvedTools.push(registered);
    }
  }

  return resolvedTools;
};
