import { z } from 'zod';

import {
  DeletePersonalSkillInputSchemaUi,
  DeletePersonalSkillOutputSchema,
  TodoToolInputSchemaUi,
  TodoToolOutputSchema,
  DeleteTodoListInputSchemaUi,
  DeleteTodoListOutputSchema,
  DeleteFileInputSchemaUi,
  DeleteFileOutputSchema,
  FetchToolInputSchemaUi,
  FetchToolOutputSchema,
  ListPersonalSkillsInputSchemaUi,
  ListPersonalSkillsOutputSchema,
  LoadSkillInputSchemaUi,
  LoadSkillOutputSchema,
  ListTodoListsInputSchemaUi,
  ListTodoListsOutputSchema,
  ListDirInputSchemaUi,
  ListDirOutputSchema,
  ReadPersonalSkillInputSchemaUi,
  ReadPersonalSkillOutputSchema,
  ReadTodoListInputSchemaUi,
  ReadTodoListOutputSchema,
  ReadFileInputSchemaUi,
  ReadFileOutputSchema,
  ShellToolInputSchemaUi,
  ShellToolOutputSchema,
  WebToolInputSchemaUi,
  WebToolOutputSchema,
  WritePersonalSkillInputSchemaUi,
  WritePersonalSkillOutputSchema,
  WriteTodoListInputSchemaUi,
  WriteTodoListOutputSchema,
  WriteFileInputSchemaUi,
  WriteFileOutputSchema,
} from '../../core/tools/schemas';
import { normalizeToolNameKey } from './tool_parts';
import { parseMaybeJson } from './tool_parts/parse';

export type WebToolInput = z.infer<typeof WebToolInputSchemaUi>;
export type FetchToolInput = z.infer<typeof FetchToolInputSchemaUi>;
export type ShellToolInput = z.infer<typeof ShellToolInputSchemaUi>;
export type ReadFileToolInput = z.infer<typeof ReadFileInputSchemaUi>;
export type WriteFileToolInput = z.infer<typeof WriteFileInputSchemaUi>;
export type ListDirToolInput = z.infer<typeof ListDirInputSchemaUi>;
export type DeleteFileToolInput = z.infer<typeof DeleteFileInputSchemaUi>;
export type LoadSkillToolInput = z.infer<typeof LoadSkillInputSchemaUi>;
export type ListPersonalSkillsToolInput = z.infer<typeof ListPersonalSkillsInputSchemaUi>;
export type ReadPersonalSkillToolInput = z.infer<typeof ReadPersonalSkillInputSchemaUi>;
export type WritePersonalSkillToolInput = z.infer<typeof WritePersonalSkillInputSchemaUi>;
export type DeletePersonalSkillToolInput = z.infer<typeof DeletePersonalSkillInputSchemaUi>;
export type TodoToolInput = z.infer<typeof TodoToolInputSchemaUi>;
export type ListTodoListsToolInput = z.infer<typeof ListTodoListsInputSchemaUi>;
export type ReadTodoListToolInput = z.infer<typeof ReadTodoListInputSchemaUi>;
export type WriteTodoListToolInput = z.infer<typeof WriteTodoListInputSchemaUi>;
export type DeleteTodoListToolInput = z.infer<typeof DeleteTodoListInputSchemaUi>;

export type WebToolOutput = z.infer<typeof WebToolOutputSchema>;
export type FetchToolOutput = z.infer<typeof FetchToolOutputSchema>;
export type ShellToolOutput = z.infer<typeof ShellToolOutputSchema>;
export type ReadFileToolOutput = z.infer<typeof ReadFileOutputSchema>;
export type WriteFileToolOutput = z.infer<typeof WriteFileOutputSchema>;
export type ListDirToolOutput = z.infer<typeof ListDirOutputSchema>;
export type DeleteFileToolOutput = z.infer<typeof DeleteFileOutputSchema>;
export type LoadSkillToolOutput = z.infer<typeof LoadSkillOutputSchema>;
export type ListPersonalSkillsToolOutput = z.infer<typeof ListPersonalSkillsOutputSchema>;
export type ReadPersonalSkillToolOutput = z.infer<typeof ReadPersonalSkillOutputSchema>;
export type WritePersonalSkillToolOutput = z.infer<typeof WritePersonalSkillOutputSchema>;
export type DeletePersonalSkillToolOutput = z.infer<typeof DeletePersonalSkillOutputSchema>;
export type TodoToolOutput = z.infer<typeof TodoToolOutputSchema>;
export type ListTodoListsToolOutput = z.infer<typeof ListTodoListsOutputSchema>;
export type ReadTodoListToolOutput = z.infer<typeof ReadTodoListOutputSchema>;
export type WriteTodoListToolOutput = z.infer<typeof WriteTodoListOutputSchema>;
export type DeleteTodoListToolOutput = z.infer<typeof DeleteTodoListOutputSchema>;

type ToolKind =
  | 'web'
  | 'fetch'
  | 'shell'
  | 'read_file'
  | 'write_file'
  | 'list_dir'
  | 'delete_file'
  | 'load_skill'
  | 'list_personal_skills'
  | 'read_personal_skill'
  | 'write_personal_skill'
  | 'delete_personal_skill'
  | 'todo'
  | 'list_todo_lists'
  | 'read_todo_list'
  | 'write_todo_list'
  | 'delete_todo_list';

export type ParsedToolInput =
  | { kind: 'web'; input: WebToolInput }
  | { kind: 'fetch'; input: FetchToolInput }
  | { kind: 'shell'; input: ShellToolInput }
  | { kind: 'read_file'; input: ReadFileToolInput }
  | { kind: 'write_file'; input: WriteFileToolInput }
  | { kind: 'list_dir'; input: ListDirToolInput }
  | { kind: 'delete_file'; input: DeleteFileToolInput }
  | { kind: 'load_skill'; input: LoadSkillToolInput }
  | { kind: 'list_personal_skills'; input: ListPersonalSkillsToolInput }
  | { kind: 'read_personal_skill'; input: ReadPersonalSkillToolInput }
  | { kind: 'write_personal_skill'; input: WritePersonalSkillToolInput }
  | { kind: 'delete_personal_skill'; input: DeletePersonalSkillToolInput }
  | { kind: 'todo'; input: TodoToolInput }
  | { kind: 'list_todo_lists'; input: ListTodoListsToolInput }
  | { kind: 'read_todo_list'; input: ReadTodoListToolInput }
  | { kind: 'write_todo_list'; input: WriteTodoListToolInput }
  | { kind: 'delete_todo_list'; input: DeleteTodoListToolInput }
  | { kind: 'unknown'; input: unknown };

export type ParsedToolOutput =
  | { kind: 'web'; output: WebToolOutput }
  | { kind: 'fetch'; output: FetchToolOutput }
  | { kind: 'shell'; output: ShellToolOutput }
  | { kind: 'read_file'; output: ReadFileToolOutput }
  | { kind: 'write_file'; output: WriteFileToolOutput }
  | { kind: 'list_dir'; output: ListDirToolOutput }
  | { kind: 'delete_file'; output: DeleteFileToolOutput }
  | { kind: 'load_skill'; output: LoadSkillToolOutput }
  | { kind: 'list_personal_skills'; output: ListPersonalSkillsToolOutput }
  | { kind: 'read_personal_skill'; output: ReadPersonalSkillToolOutput }
  | { kind: 'write_personal_skill'; output: WritePersonalSkillToolOutput }
  | { kind: 'delete_personal_skill'; output: DeletePersonalSkillToolOutput }
  | { kind: 'todo'; output: TodoToolOutput }
  | { kind: 'list_todo_lists'; output: ListTodoListsToolOutput }
  | { kind: 'read_todo_list'; output: ReadTodoListToolOutput }
  | { kind: 'write_todo_list'; output: WriteTodoListToolOutput }
  | { kind: 'delete_todo_list'; output: DeleteTodoListToolOutput }
  | { kind: 'unknown'; output: unknown };

const TOOL_SCHEMAS: Record<ToolKind, { input: z.ZodTypeAny; output: z.ZodTypeAny }> = {
  web: { input: WebToolInputSchemaUi, output: WebToolOutputSchema },
  fetch: { input: FetchToolInputSchemaUi, output: FetchToolOutputSchema },
  shell: { input: ShellToolInputSchemaUi, output: ShellToolOutputSchema },
  read_file: { input: ReadFileInputSchemaUi, output: ReadFileOutputSchema },
  write_file: { input: WriteFileInputSchemaUi, output: WriteFileOutputSchema },
  list_dir: { input: ListDirInputSchemaUi, output: ListDirOutputSchema },
  delete_file: { input: DeleteFileInputSchemaUi, output: DeleteFileOutputSchema },
  load_skill: { input: LoadSkillInputSchemaUi, output: LoadSkillOutputSchema },
  list_personal_skills: {
    input: ListPersonalSkillsInputSchemaUi,
    output: ListPersonalSkillsOutputSchema,
  },
  read_personal_skill: {
    input: ReadPersonalSkillInputSchemaUi,
    output: ReadPersonalSkillOutputSchema,
  },
  write_personal_skill: {
    input: WritePersonalSkillInputSchemaUi,
    output: WritePersonalSkillOutputSchema,
  },
  delete_personal_skill: {
    input: DeletePersonalSkillInputSchemaUi,
    output: DeletePersonalSkillOutputSchema,
  },
  todo: { input: TodoToolInputSchemaUi, output: TodoToolOutputSchema },
  list_todo_lists: { input: ListTodoListsInputSchemaUi, output: ListTodoListsOutputSchema },
  read_todo_list: { input: ReadTodoListInputSchemaUi, output: ReadTodoListOutputSchema },
  write_todo_list: { input: WriteTodoListInputSchemaUi, output: WriteTodoListOutputSchema },
  delete_todo_list: { input: DeleteTodoListInputSchemaUi, output: DeleteTodoListOutputSchema },
};

const TOOL_ALIASES: Record<string, ToolKind> = {
  web_search: 'web',
};

type ToolSchemaMap = typeof TOOL_SCHEMAS;
type ToolInputByKind = { [K in ToolKind]: z.infer<ToolSchemaMap[K]['input']> };
type ToolOutputByKind = { [K in ToolKind]: z.infer<ToolSchemaMap[K]['output']> };

const resolveToolKind = (toolName: string): ToolKind | null => {
  const toolKey = normalizeToolNameKey(toolName);
  if (Object.prototype.hasOwnProperty.call(TOOL_SCHEMAS, toolKey)) {
    return toolKey as ToolKind;
  }
  return TOOL_ALIASES[toolKey] ?? null;
};

const parseWithSchema = <T extends z.ZodTypeAny>(schema: T, value: unknown): z.infer<T> | null => {
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : null;
};

const normalizeInputValue = (value: unknown): unknown => {
  if (typeof value === 'object' && value !== null) return value;
  return parseMaybeJson(value);
};

const normalizeOutputValue = (value: unknown): unknown => parseMaybeJson(value);

export const parseToolInput = (toolName: string, value: unknown): ParsedToolInput => {
  const toolKind = resolveToolKind(toolName);
  if (!toolKind) return { kind: 'unknown', input: value };

  const normalizedValue = normalizeInputValue(value);
  const parsed = parseWithSchema(TOOL_SCHEMAS[toolKind].input, normalizedValue) as
    | ToolInputByKind[typeof toolKind]
    | null;

  return parsed
    ? ({ kind: toolKind, input: parsed } as ParsedToolInput)
    : { kind: 'unknown', input: value };
};

export const parseToolOutput = (toolName: string, value: unknown): ParsedToolOutput => {
  const toolKind = resolveToolKind(toolName);
  if (!toolKind) return { kind: 'unknown', output: value };

  const normalizedValue = normalizeOutputValue(value);
  const parsed = parseWithSchema(TOOL_SCHEMAS[toolKind].output, normalizedValue) as
    | ToolOutputByKind[typeof toolKind]
    | null;

  return parsed
    ? ({ kind: toolKind, output: parsed } as ParsedToolOutput)
    : { kind: 'unknown', output: value };
};

export const parseToolPayload = (toolName: string, input: unknown, output: unknown) => ({
  input: parseToolInput(toolName, input),
  output: parseToolOutput(toolName, output),
});
