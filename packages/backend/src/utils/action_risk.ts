export type ActionRisk = 'safe' | 'escalate';

export type ToolApprovalDecision = 'allow' | 'ask';

export type ApprovalPolicy = 'never' | 'trustWorkspace' | 'askRisky' | 'always';

export const READ_TOOLS = new Set([
  'read_file',
  'web_search',
  'fetch',
  'load_skill',
  'list_personal_skills',
  'read_personal_skill',
  'list_todo_lists',
  'read_todo_list',
  'list_awaiters',
  'read_awaiter',
  'list_proactive_tasks',
  'read_proactive_task',
]);

export const WORKSPACE_WRITE_TOOLS = new Set(['write_file', 'edit', 'undo_edit']);

export type ToolApprovalDeclaration = {
  name: string;

  needsApproval?: boolean | ((input: unknown, options?: unknown) => boolean | Promise<boolean>);

  approvalMode?: 'configurable' | 'always';
};

export type ToolApprovalInput = {

  policy?: ApprovalPolicy;

  input?: unknown;

  autoApprove?: boolean;

  requireApproval?: boolean;

  declaredDecision?: boolean;
};

const declaration = (tool: ToolApprovalDeclaration): ToolApprovalDecision => {
  if (tool.needsApproval === true) return 'ask';

  if (typeof tool.needsApproval === 'function') return 'ask';
  return 'allow';
};

export const decideToolApproval = (
  tool: ToolApprovalDeclaration,
  input: ToolApprovalInput = {}
): ToolApprovalDecision => {
  const declared = declaration(tool);

  if (tool.approvalMode === 'always' && input.policy !== 'never') return 'ask';

  if (input.policy) {

    if (input.policy === 'never') return 'allow';

    if (input.policy === 'always') return 'ask';
    const trustWorkspace = input.policy === 'trustWorkspace';
    const classified =
      READ_TOOLS.has(tool.name) || (trustWorkspace && WORKSPACE_WRITE_TOOLS.has(tool.name));

    return classified ? 'allow' : 'ask';
  }

  if (declared === 'ask') {
    return input.autoApprove ? 'allow' : 'ask';
  }
  return input.requireApproval ? 'ask' : 'allow';
};

export const approvalDecisionToBoolean = (decision: ToolApprovalDecision): boolean =>
  decision === 'ask';
