import {
  composePrepareSteps,
  createPlanThenExecutePrepareStep,
  createSimpleAgentRunner,
  type AgentRunner,
  type AgentTool,
} from '@iki/core/agent';
import { getAppConfig } from '@iki/backend/config';
import { createLogger } from '@iki/core/logger';
import { defaultToolRegistry } from '@iki/core/tools';
import { LoadSkillTool } from '@iki/backend/tools/skill_tools';
import { applyToolApprovalPolicy } from '@iki/core/utils/tool_approval';
import { resolveChatToolMaxIterations } from './constants';
import { createTodoPrepareStep } from './todo_planning';

const logger = createLogger({ module: 'chat_agent_runner' });

const GUARD_BYPASS_TOOLS = new Set(['handoff', 'plan', 'todo']);

const getEmotionConfig = () => getAppConfig()?.memory?.emotion || null;
const shouldAutoApproveToolRequests = () =>
  getAppConfig()?.general?.autoApproveToolRequests === true;

const prepareToolWithGuard = (
  toolName: string,
  guardActive: boolean
): AgentTool | null => {
  const tool = defaultToolRegistry.get(toolName);
  if (!tool) return null;

  const emotionConfig = getEmotionConfig();
  const requireApproval = guardActive && Boolean(emotionConfig?.toolGuard?.requireApproval);

  let resolved = tool;
  if (requireApproval) {
    resolved = { ...tool, needsApproval: true };
  } else if (!guardActive && tool.approvalMode !== 'always') {
    // When the guard is inactive, tools should not require approval
    // unless they carry approvalMode: 'always' (e.g. skill/task CRUD).
    resolved = { ...tool, needsApproval: false };
  }

  return applyToolApprovalPolicy(resolved, {
    autoApproveToolRequests: shouldAutoApproveToolRequests(),
  });
};

export const createChatAgentRunner = (params: {
  threadId?: string;
  providerType: string;
  providerId?: string;
  model: string;
  systemPrompt: string;
  enableTools: boolean;
  enabledTools: string[];
  availableSkillIds: string[];
  guardActive: boolean;
  maxIterations: number;
  maxOutputTokens?: number;
}): { runner: AgentRunner; tools: AgentTool[] } => {
  const config: Record<string, unknown> = {
    enabled: true,
    providerType: params.providerType,
    ...(typeof params.providerId === 'string' && params.providerId.trim()
      ? { providerId: params.providerId.trim() }
      : {}),
    model: params.model,
    systemPrompt: params.systemPrompt,
    enableTools: params.enableTools,
    maxIterations: resolveChatToolMaxIterations(params.maxIterations),
    ...(typeof params.maxOutputTokens === 'number'
      ? { maxTokens: params.maxOutputTokens }
      : {}),
  };

  if (params.enableTools) {
    config.prepareStep = composePrepareSteps(
      createPlanThenExecutePrepareStep(params.enabledTools),
      createTodoPrepareStep(params.enabledTools)
    );
  }

  const runner = createSimpleAgentRunner(config as Parameters<typeof createSimpleAgentRunner>[0]);

  const resolvedTools: AgentTool[] = [];

  if (params.enableTools) {
    for (const toolName of GUARD_BYPASS_TOOLS) {
      const tool = defaultToolRegistry.get(toolName);
      if (tool) resolvedTools.push(tool);
    }

    if (params.availableSkillIds.length > 0) {
      const loadSkill = new LoadSkillTool().toAgentTool();
      resolvedTools.push(loadSkill);
    }

    for (const toolName of params.enabledTools) {
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
  }

  return { runner, tools: resolvedTools };
};
