type ApprovalAnnotated = {
  needsApproval?: unknown;
};

export type ToolApprovalPolicyOptions = {
  autoApproveToolRequests: boolean;
};

export const applyToolApprovalPolicy = <T extends ApprovalAnnotated>(
  value: T,
  options: ToolApprovalPolicyOptions
): T => {
  if (!options.autoApproveToolRequests) return value;
  if (value.needsApproval === false || value.needsApproval === undefined) return value;
  return { ...value, needsApproval: false } as T;
};

export const applyToolApprovalPolicyList = <T extends ApprovalAnnotated>(
  values: T[],
  options: ToolApprovalPolicyOptions
): T[] => {
  if (!options.autoApproveToolRequests) return values;
  return values.map(value => applyToolApprovalPolicy(value, options));
};
