

export type ModelToolResultOutput =
  | { type: 'text'; value: string }
  | { type: 'json'; value: unknown }
  | { type: 'error-text'; value: string }
  | { type: 'error-json'; value: unknown }
  | { type: 'content'; value: unknown }
  | { type: 'execution-denied'; reason?: string };

export type ModelToolResultContentPart = {
  type: 'tool-result';
  toolCallId: string;
  toolName: string;
  output?: unknown;
  [key: string]: unknown;
};

export type ModelToolCallContentPart = {
  type: 'tool-call';
  toolCallId: string;
  toolName: string;
  input?: unknown;
  [key: string]: unknown;
};

export type ModelContentPart =
  | ModelToolResultContentPart
  | ModelToolCallContentPart
  | { type: string; [key: string]: unknown };

export type ModelMessage =
  | { role: 'system'; content: string | ModelContentPart[] }
  | { role: 'user'; content: string | ModelContentPart[] }
  | { role: 'assistant'; content: string | ModelContentPart[] }

  | { role: 'tool'; content: ModelContentPart[] };

export const cloneModelMessages = (messages?: ModelMessage[]): ModelMessage[] => {
  if (!messages || messages.length === 0) {
    return [];
  }

  return structuredClone(messages);
};

export const appendUserPromptToHistory = (
  history: ModelMessage[],
  prompt: string
): ModelMessage[] => [
  ...history,
  {
    role: 'user',
    content: prompt,
  },
];

export type ToolApprovalResponse = {

  type: 'tool-approval-response';
  approvalId: string;
  approved: boolean;
  reason?: string;
};
