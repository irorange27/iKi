import { createLogger } from '@iki/backend/logger';
import { defaultToolRegistry } from '@iki/backend/tools';
import { LoadSkillTool } from '@iki/backend/tools/skill_tools';
import { applyToolApprovalPolicy } from '@iki/backend/utils/tool_approval';
import { classifyActionRisk } from '@iki/backend/utils/action_risk';
import { listToolAllowPatterns } from '@iki/backend/db/tool_allowlist';
import type { AgentTool } from '@iki/backend/agent/types';

const logger = createLogger({ module: 'tool_resolver' });

/**
 * Session/turn-level approval policy (ADR 005). 'never' is a legitimate
 * headless mode (evals, daemon automation); 'trustWorkspace' upgrades to
 * action-risk classification once utils/action_risk.ts lands.
 */
export type ApprovalPolicy = 'never' | 'trustWorkspace' | 'askRisky' | 'always';

/**
 * Per-step policy snapshot. One SDK step's tool calls all read the same box, so
 * a plan runs under one coherent policy and a user change lands on the next
 * step rather than mid-plan. Advancing clears the allowlist read; the decision
 * itself is taken at call time.
 */
export type ApprovalPolicyBox = {
  policy: ApprovalPolicy | undefined;
  allowPatterns: Map<string, string[]>;
};

export const createApprovalPolicyBox = (
  policy?: ApprovalPolicy
): ApprovalPolicyBox => ({ policy, allowPatterns: new Map() });

/** Called once per SDK step (agent_harness onModelStep). */
export const advanceApprovalPolicySnapshot = (
  box: ApprovalPolicyBox,
  policy?: ApprovalPolicy
): void => {
  box.policy = policy;
  box.allowPatterns.clear();
};

const GUARD_BYPASS_TOOLS = new Set(['handoff', 'plan', 'todo']);

/** Resolve-time decision: the pre-ADR-005 flags and an explicit fixed policy. */
const resolveStaticTool = (
  tool: AgentTool,
  approvalPolicy: ApprovalPolicy | undefined,
  guardActive: boolean,
  requireApproval: boolean,
  autoApproveToolRequests: boolean
): AgentTool => {
  let resolved = tool;
  if (approvalPolicy === 'never') {
    resolved = { ...tool, needsApproval: false };
  } else if (approvalPolicy === 'always') {
    resolved = { ...tool, needsApproval: true };
  } else if (approvalPolicy === 'trustWorkspace' || approvalPolicy === 'askRisky') {
    const allowPatterns = listToolAllowPatterns(tool.name);
    resolved = {
      ...tool,
      needsApproval: (input: unknown) =>
        classifyActionRisk(tool.name, input, allowPatterns, approvalPolicy === 'trustWorkspace') === 'escalate',
    };
  } else if (requireApproval) {
    resolved = { ...tool, needsApproval: true };
  } else if (!guardActive && tool.approvalMode !== 'always') {
    resolved = { ...tool, needsApproval: false };
  }

  return approvalPolicy ? resolved : applyToolApprovalPolicy(resolved, { autoApproveToolRequests });
};

const prepareToolWithGuard = (
  toolName: string,
  approvalPolicy: ApprovalPolicy | undefined,
  guardActive: boolean,
  requireApproval: boolean,
  autoApproveToolRequests: boolean,
  policyBox?: ApprovalPolicyBox
): AgentTool | null => {
  const tool = defaultToolRegistry.get(toolName);
  if (!tool) return null;

  if (!policyBox) {
    return resolveStaticTool(tool, approvalPolicy, guardActive, requireApproval, autoApproveToolRequests);
  }

  // Decide at call time against the current per-step snapshot, so the dial and
  // the learned allow rules advance together at the step boundary. A turn
  // without an explicit policy still falls back to the legacy flags — never
  // escalate by default just because a snapshot exists.
  const fallback = resolveStaticTool(tool, undefined, guardActive, requireApproval, autoApproveToolRequests);
  return {
    ...tool,
    needsApproval: (
      input: unknown,
      options: { toolCallId: string; messages: unknown[]; experimental_context?: unknown }
    ) => {
      const policy = policyBox.policy ?? approvalPolicy;
      if (policy === 'never') return false;
      if (policy === 'always') return true;
      if (policy === 'trustWorkspace' || policy === 'askRisky') {
        let patterns = policyBox.allowPatterns.get(toolName);
        if (!patterns) {
          patterns = listToolAllowPatterns(toolName);
          policyBox.allowPatterns.set(toolName, patterns);
        }
        return classifyActionRisk(toolName, input, patterns, policy === 'trustWorkspace') === 'escalate';
      }
      const legacy = fallback.needsApproval;
      return typeof legacy === 'function' ? legacy(input, options) : Boolean(legacy);
    },
  };
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
  /**
   * Per-step snapshot. When present, `needsApproval` decides against the box at
   * call time so the dial and learned allow rules advance together; without it
   * the decision is baked in at resolve time.
   */
  approvalPolicyBox?: ApprovalPolicyBox;
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
      params.approvalPolicyBox,
    );
    if (registered) {
      resolvedTools.push(registered);
    }
  }

  return resolvedTools;
};
