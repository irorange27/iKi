export const shouldLogChunk = (count: number) => count <= 3 || count % 20 === 0;

export const TOOL_AGENT_SYSTEM_PROMPT =
  'You can use tools (filesystem, shell, web) when they are necessary to solve the task.\n' +
  'Rules:\n' +
  '- Prefer answering directly when tools are not needed.\n' +
  '- Use the minimal number of tool calls needed for correctness.\n' +
  '- For each tool call, include a `description` field in the tool arguments: one short sentence explaining why you are calling the tool.\n' +
  '- Be conservative with destructive actions (writing/deleting files, risky shell commands).\n' +
  '- When using file paths, stay within the workspace.\n';

