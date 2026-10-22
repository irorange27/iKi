import { createLogger } from '@iki/backend/logger';
import { defaultToolRegistry } from '@iki/backend/tools';
import { LoadSkillTool } from '@iki/backend/tools/skill_tools';
import {
  decideToolApproval,
  type ApprovalPolicy,
  type ToolApprovalDeclaration,
} from '@iki/backend/utils/action_risk';
import type { AgentTool } from '@iki/backend/agent/types';

const logger = createLogger({ module: 'tool_resolver' });

export type { ApprovalPolicy };

export type ApprovalPolicyBox = {
  policy: ApprovalPolicy | undefined;
};

export const createApprovalPolicyBox = (policy?: ApprovalPolicy): ApprovalPolicyBox => ({
  policy,
});

export const advanceApprovalPolicySnapshot = (
  box: ApprovalPolicyBox,
  policy?: ApprovalPolicy
): void => {
  box.policy = policy;
};

type StaticDecisionInput = {
  policy?: ApprovalPolicy;
  requireApproval: boolean;
  autoApprove: boolean;
};

const resolveStaticTool = (
  tool: AgentTool,
  staticInput: StaticDecisionInput,
  policyBox: ApprovalPolicyBox
): AgentTool => {
  const declaredNeedsApproval = tool.needsApproval === true ? true : false;
  const declaration = tool as ToolApprovalDeclaration;
  const declaredFunction =
    typeof tool.needsApproval === 'function'
      ? (tool.needsApproval as (input: unknown, options?: unknown) => boolean | Promise<boolean>)
      : undefined;

  const decide = async (input: unknown, options?: unknown): Promise<boolean> => {

    const policy = policyBox.policy ?? staticInput.policy;

    const declaredDecision = declaredFunction
      ? Boolean(await declaredFunction.call(tool, input, options))
      : undefined;
    return (
      decideToolApproval(declaration, {
        ...(policy ? { policy } : {}),
        ...(input !== undefined ? { input } : {}),
        autoApprove: staticInput.autoApprove,
        requireApproval: staticInput.requireApproval,
        ...(declaredDecision !== undefined ? { declaredDecision } : {}),
      }) === 'ask'
    );
  };

  const needsApproval = declaredFunction
    ? (input: unknown, options?: unknown) => decide(input, options)
    : (input: unknown) => decide(input);

  return { ...tool, declaredNeedsApproval, needsApproval };
};

const prepareToolWithGuard = (
  toolName: string,
  staticInput: StaticDecisionInput,
  policyBox: ApprovalPolicyBox
): AgentTool | null => {
  const tool = defaultToolRegistry.get(toolName);
  if (!tool) return null;
  return resolveStaticTool(tool, staticInput, policyBox);
};

export const resolveTools = (params: {
  enableTools: boolean;
  enabledToolNames: string[];
  availableSkillIds: string[];
  requireApproval: boolean;
  autoApproveToolRequests: boolean;

  approvalPolicy?: ApprovalPolicy;

  approvalPolicyBox?: ApprovalPolicyBox;
  skillToolFactory?: () => AgentTool;
}): AgentTool[] => {
  if (!params.enableTools) return [];

  const resolvedTools: AgentTool[] = [];
  const staticInput: StaticDecisionInput = {
    ...(params.approvalPolicy ? { policy: params.approvalPolicy } : {}),
    requireApproval: params.requireApproval,
    autoApprove: params.autoApproveToolRequests,
  };
  const policyBox = params.approvalPolicyBox ?? createApprovalPolicyBox(params.approvalPolicy);

  for (const toolName of params.enabledToolNames) {
    if (toolName === 'load_skill') {
      if (params.availableSkillIds.length > 0) {
        resolvedTools.push(
          params.skillToolFactory ? params.skillToolFactory() : new LoadSkillTool().toAgentTool()
        );
      }
      continue;
    }
    if (!defaultToolRegistry.get(toolName)) {
      logger.warn(`Tool ${toolName} not found in registry`);
      continue;
    }
    const registered = prepareToolWithGuard(toolName, staticInput, policyBox);
    if (registered) {
      resolvedTools.push(registered);
    }
  }

  return resolvedTools;
};
