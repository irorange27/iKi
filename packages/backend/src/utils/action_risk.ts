import { isDeepStrictEqual } from 'node:util';

export type ActionRisk = 'safe' | 'escalate';

const READ_TOOLS = new Set(['read_file', 'web_search', 'fetch', 'load_skill', 'list_personal_skills', 'read_personal_skill', 'list_todo_lists', 'read_todo_list', 'list_awaiters', 'read_awaiter', 'list_proactive_tasks', 'read_proactive_task']);
const WORKSPACE_WRITE_TOOLS = new Set(['write_file', 'edit', 'undo_edit']);

export const classifyActionRisk = (
  toolName: string,
  input: unknown,
  allowPatterns: string[] = [],
  trustWorkspace = true
): ActionRisk => {
  for (const pattern of allowPatterns) {
    if (pattern === '') return 'safe';
    try {
      if (isDeepStrictEqual(JSON.parse(pattern), input)) return 'safe';
    } catch {
      // Legacy substring rules cannot establish authorization for a complete call.
    }
  }
  return READ_TOOLS.has(toolName) || (trustWorkspace && WORKSPACE_WRITE_TOOLS.has(toolName)) ? 'safe' : 'escalate';
};
