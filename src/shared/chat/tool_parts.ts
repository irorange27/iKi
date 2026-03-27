export type {
  DynamicToolPart,
  DynamicToolState,
  ToolApproval,
  ToolPart,
} from './message_parts';
export { isObjectRecord } from './message_parts';

export { getApprovalId, getToolCallIdFromPart } from './tool_parts/ids';
export {
  isApprovalRequestedPart,
  isToolCallPart,
  isToolPart,
  isToolResultPart,
} from './tool_parts/guards';
export {
  getToolInput,
  getToolName,
  getToolOutput,
  normalizeDynamicToolPart,
  normalizeToolPartForValidation,
  normalizeToolNameKey,
} from './tool_parts/normalize';
export { parseMaybeJson, parseToolInputFromText } from './tool_parts/parse';
