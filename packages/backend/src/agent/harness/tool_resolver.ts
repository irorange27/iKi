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

/**
 * Session/turn-level approval policy (ADR 005). Re-exported from
 * `utils/action_risk`, where the dialect's type lives next to the single
 * decision function — `turn_prep/tool_guard` must be able to call the decision
 * without importing the harness (dependency direction).
 */
export type { ApprovalPolicy };

/**
 * Per-step policy snapshot. One SDK step's tool calls all read the same box, so
 * a plan runs under one coherent policy and a user change lands on the next
 * step rather than mid-plan.
 */
export type ApprovalPolicyBox = {
  policy: ApprovalPolicy | undefined;
};

export const createApprovalPolicyBox = (policy?: ApprovalPolicy): ApprovalPolicyBox => ({
  policy,
});

/** Called once per SDK step (agent_harness onModelStep). */
export const advanceApprovalPolicySnapshot = (
  box: ApprovalPolicyBox,
  policy?: ApprovalPolicy
): void => {
  box.policy = policy;
};

/** The decision inputs that do not depend on the call. */
type StaticDecisionInput = {
  policy?: ApprovalPolicy;
  requireApproval: boolean;
  autoApprove: boolean;
};

/**
 * Resolve one registry tool into the tool the turn actually exposes.
 *
 * `declaredNeedsApproval` records the tool's OWN declaration before any policy
 * decision: `needsApproval` is a live per-call decision, so consumers such as
 * delegation need the static answer kept separately (README "Delegation
 * boundary").
 *
 * `needsApproval` is the ONE predicate the harness evaluates, and it delegates
 * to `decideToolApproval` — the single authority (its precedence and ADR
 * references live with it in `utils/action_risk.ts`). This function does NOT
 * reimplement any part of that decision. An earlier version kept four policy
 * branches here plus a legacy rewriter in `utils/tool_approval.ts`, and the
 * three paths disagreed about `approvalMode: 'always'` and about whether a
 * dial may lower a tool's own declaration (audit D1/D2/D9, #166).
 */
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

  // The learned allow rules were removed with `db/tool_allowlist.ts`: nothing
  // ever wrote a rule, so the branch could only ever read an empty list.
  const decide = async (input: unknown, options?: unknown): Promise<boolean> => {
    // The box is the per-step snapshot when the caller supplied one; otherwise
    // it holds exactly the turn's policy and never advances.
    const policy = policyBox.policy ?? staticInput.policy;
    // A function-valued declaration answers for THIS call; the resolver only
    // forwards that answer to the single decision.
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

  // A function declaration keeps the function shape (consumers distinguish
  // "computes its own answer" from "is a boolean"); everything else gets the
  // same single decision behind a one-argument predicate.
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

/**
 * Resolve the tool set for one turn from the caller's grants.
 *
 * The resolved set is exactly `enabledToolNames` plus the skill loader when
 * skills are available. Nothing is added behind the caller's back: `todo` and
 * `plan` write durable state (the thread's todo plan and the task plan) and
 * `handoff` restarts the turn, so a caller that wants a loop-control tool must
 * name it in `enabledToolNames` — where the same guard and approval policy
 * then evaluate it like any other tool. Injecting them anyway would silently
 * widen a daemon grant, a NapCat allow-list or a pre-filtered safe list past
 * the caller's stated bound.
 */
export const resolveTools = (params: {
  enableTools: boolean;
  enabledToolNames: string[];
  availableSkillIds: string[];
  requireApproval: boolean;
  autoApproveToolRequests: boolean;
  /** ADR 005: overrides requireApproval (and the global switch) when present. */
  approvalPolicy?: ApprovalPolicy;
  /**
   * Per-step snapshot. When present, `needsApproval` decides against the box at
   * call time so the dial advances per step; without it a box holding exactly
   * this turn's policy is created, so both paths ask the same question.
   */
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

  // The skill loader is resolved like any other tool: through the guard and
  // the approval policy, from the caller's own list. Pushing it raw whenever
  // skills exist would widen a narrow grant past its stated bound — a daemon
  // caller can filter `tools` while passing a raw `skillIds` — and would
  // bypass the policy, since the registered value needs no approval.
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
