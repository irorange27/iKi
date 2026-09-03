import { createLogger } from '@iki/backend/logger';
import { defaultToolRegistry } from '@iki/backend/tools';
import { LoadSkillTool } from '@iki/backend/tools/skill_tools';
import { applyToolApprovalPolicy } from '@iki/backend/utils/tool_approval';
import { classifyActionRisk } from '@iki/backend/utils/action_risk';
import type { AgentTool } from '@iki/backend/agent/types';

const logger = createLogger({ module: 'tool_resolver' });

/**
 * Session/turn-level approval policy (ADR 005). 'never' is a legitimate
 * headless mode (evals, daemon automation); 'trustWorkspace' upgrades to
 * action-risk classification once utils/action_risk.ts lands.
 */
export type ApprovalPolicy = 'never' | 'trustWorkspace' | 'askRisky' | 'always';

const GUARD_BYPASS_TOOLS = new Set(['handoff', 'plan', 'todo']);

const prepareToolWithGuard = (
  toolName: string,
  approvalPolicy: ApprovalPolicy | undefined,
  guardActive: boolean,
  requireApproval: boolean,
  autoApproveToolRequests: boolean,
): AgentTool | null => {
  const tool = defaultToolRegistry.get(toolName);
  if (!tool) return null;

  let resolved = tool;
  if (approvalPolicy === 'never') {
    resolved = { ...tool, needsApproval: false };
  } else if (approvalPolicy === 'always') {
    resolved = { ...tool, needsApproval: true };
  } else if (approvalPolicy === 'trustWorkspace') {
    resolved = {
      ...tool,
      needsApproval: (input: unknown) => classifyActionRisk(tool.name, input) === 'escalate',
    };
  } else if (requireApproval) {
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
  /** ADR 005: overrides guardActive/requireApproval when present. */
  approvalPolicy?: ApprovalPolicy;
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
      params.approvalPolicy,
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
