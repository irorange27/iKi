import { z } from 'zod';

import {
  AgentToolInputSchemaUi,
  AgentToolOutputSchema,
  DeleteAwaiterInputSchemaUi,
  DeleteAwaiterOutputSchema,
  DeleteFileInputSchemaUi,
  DeleteFileOutputSchema,
  DeletePersonalSkillInputSchemaUi,
  DeletePersonalSkillOutputSchema,
  DeleteProactiveTaskInputSchemaUi,
  DeleteProactiveTaskOutputSchema,
  EditFileInputSchemaUi,
  EditFileOutputSchema,
  FetchToolInputSchemaUi,
  FetchToolOutputSchema,
  ListAwaitersInputSchemaUi,
  ListAwaitersOutputSchema,
  ListPersonalSkillsInputSchemaUi,
  ListPersonalSkillsOutputSchema,
  ListProactiveTasksInputSchemaUi,
  ListProactiveTasksOutputSchema,
  LoadSkillInputSchemaUi,
  LoadSkillOutputSchema,
  ReadAwaiterInputSchemaUi,
  ReadAwaiterOutputSchema,
  ReadFileInputSchemaUi,
  ReadFileOutputSchema,
  ReadPersonalSkillInputSchemaUi,
  ReadPersonalSkillOutputSchema,
  ReadProactiveTaskInputSchemaUi,
  ReadProactiveTaskOutputSchema,
  ShellToolInputSchemaUi,
  ShellToolOutputSchema,
  WebToolInputSchemaUi,
  WebToolOutputSchema,
  WriteAwaiterInputSchemaUi,
  WriteAwaiterOutputSchema,
  WriteFileInputSchemaUi,
  WriteFileOutputSchema,
  WritePersonalSkillInputSchemaUi,
  WritePersonalSkillOutputSchema,
  WriteProactiveTaskInputSchemaUi,
  WriteProactiveTaskOutputSchema,
} from '@iki/backend/tools/schemas';
import {
  parseToolInputPayload,
  parseToolOutputPayload,
  type ToolPayloadKind,
  type ToolPayloadValidator,
} from './tool_payload_contracts';

export type WebToolInput = z.infer<typeof WebToolInputSchemaUi>;
export type FetchToolInput = z.infer<typeof FetchToolInputSchemaUi>;
export type ShellToolInput = z.infer<typeof ShellToolInputSchemaUi>;
export type ReadFileToolInput = z.infer<typeof ReadFileInputSchemaUi>;
export type WriteFileToolInput = z.infer<typeof WriteFileInputSchemaUi>;
export type EditFileToolInput = z.infer<typeof EditFileInputSchemaUi>;
export type DeleteFileToolInput = z.infer<typeof DeleteFileInputSchemaUi>;
export type LoadSkillToolInput = z.infer<typeof LoadSkillInputSchemaUi>;
export type ListPersonalSkillsToolInput = z.infer<typeof ListPersonalSkillsInputSchemaUi>;
export type ReadPersonalSkillToolInput = z.infer<typeof ReadPersonalSkillInputSchemaUi>;
export type WritePersonalSkillToolInput = z.infer<typeof WritePersonalSkillInputSchemaUi>;
export type DeletePersonalSkillToolInput = z.infer<typeof DeletePersonalSkillInputSchemaUi>;
export type AgentToolInput = z.infer<typeof AgentToolInputSchemaUi>;
export type ListAwaitersToolInput = z.infer<typeof ListAwaitersInputSchemaUi>;
export type ReadAwaiterToolInput = z.infer<typeof ReadAwaiterInputSchemaUi>;
export type WriteAwaiterToolInput = z.infer<typeof WriteAwaiterInputSchemaUi>;
export type DeleteAwaiterToolInput = z.infer<typeof DeleteAwaiterInputSchemaUi>;
export type ListProactiveTasksToolInput = z.infer<typeof ListProactiveTasksInputSchemaUi>;
export type ReadProactiveTaskToolInput = z.infer<typeof ReadProactiveTaskInputSchemaUi>;
export type WriteProactiveTaskToolInput = z.infer<typeof WriteProactiveTaskInputSchemaUi>;
export type DeleteProactiveTaskToolInput = z.infer<typeof DeleteProactiveTaskInputSchemaUi>;

export type WebToolOutput = z.infer<typeof WebToolOutputSchema>;
export type FetchToolOutput = z.infer<typeof FetchToolOutputSchema>;
export type ShellToolOutput = z.infer<typeof ShellToolOutputSchema>;
export type ReadFileToolOutput = z.infer<typeof ReadFileOutputSchema>;
export type WriteFileToolOutput = z.infer<typeof WriteFileOutputSchema>;
export type EditFileToolOutput = z.infer<typeof EditFileOutputSchema>;
export type DeleteFileToolOutput = z.infer<typeof DeleteFileOutputSchema>;
export type LoadSkillToolOutput = z.infer<typeof LoadSkillOutputSchema>;
export type ListPersonalSkillsToolOutput = z.infer<typeof ListPersonalSkillsOutputSchema>;
export type ReadPersonalSkillToolOutput = z.infer<typeof ReadPersonalSkillOutputSchema>;
export type WritePersonalSkillToolOutput = z.infer<typeof WritePersonalSkillOutputSchema>;
export type DeletePersonalSkillToolOutput = z.infer<typeof DeletePersonalSkillOutputSchema>;
export type AgentToolOutput = z.infer<typeof AgentToolOutputSchema>;
export type ListAwaitersToolOutput = z.infer<typeof ListAwaitersOutputSchema>;
export type ReadAwaiterToolOutput = z.infer<typeof ReadAwaiterOutputSchema>;
export type WriteAwaiterToolOutput = z.infer<typeof WriteAwaiterOutputSchema>;
export type DeleteAwaiterToolOutput = z.infer<typeof DeleteAwaiterOutputSchema>;
export type ListProactiveTasksToolOutput = z.infer<typeof ListProactiveTasksOutputSchema>;
export type ReadProactiveTaskToolOutput = z.infer<typeof ReadProactiveTaskOutputSchema>;
export type WriteProactiveTaskToolOutput = z.infer<typeof WriteProactiveTaskOutputSchema>;
export type DeleteProactiveTaskToolOutput = z.infer<typeof DeleteProactiveTaskOutputSchema>;

export type ParsedToolInput =
  | { kind: 'web'; input: WebToolInput }
  | { kind: 'fetch'; input: FetchToolInput }
  | { kind: 'shell'; input: ShellToolInput }
  | { kind: 'read_file'; input: ReadFileToolInput }
  | { kind: 'write_file'; input: WriteFileToolInput }
  | { kind: 'edit'; input: EditFileToolInput }
  | { kind: 'delete_file'; input: DeleteFileToolInput }
  | { kind: 'load_skill'; input: LoadSkillToolInput }
  | { kind: 'list_personal_skills'; input: ListPersonalSkillsToolInput }
  | { kind: 'read_personal_skill'; input: ReadPersonalSkillToolInput }
  | { kind: 'write_personal_skill'; input: WritePersonalSkillToolInput }
  | { kind: 'delete_personal_skill'; input: DeletePersonalSkillToolInput }
  | { kind: 'agent'; input: AgentToolInput }
  | { kind: 'list_awaiters'; input: ListAwaitersToolInput }
  | { kind: 'read_awaiter'; input: ReadAwaiterToolInput }
  | { kind: 'write_awaiter'; input: WriteAwaiterToolInput }
  | { kind: 'delete_awaiter'; input: DeleteAwaiterToolInput }
  | { kind: 'list_proactive_tasks'; input: ListProactiveTasksToolInput }
  | { kind: 'read_proactive_task'; input: ReadProactiveTaskToolInput }
  | { kind: 'write_proactive_task'; input: WriteProactiveTaskToolInput }
  | { kind: 'delete_proactive_task'; input: DeleteProactiveTaskToolInput }
  | { kind: 'unknown'; input: unknown };

export type ParsedToolOutput =
  | { kind: 'web'; output: WebToolOutput }
  | { kind: 'fetch'; output: FetchToolOutput }
  | { kind: 'shell'; output: ShellToolOutput }
  | { kind: 'read_file'; output: ReadFileToolOutput }
  | { kind: 'write_file'; output: WriteFileToolOutput }
  | { kind: 'edit'; output: EditFileToolOutput }
  | { kind: 'delete_file'; output: DeleteFileToolOutput }
  | { kind: 'load_skill'; output: LoadSkillToolOutput }
  | { kind: 'list_personal_skills'; output: ListPersonalSkillsToolOutput }
  | { kind: 'read_personal_skill'; output: ReadPersonalSkillToolOutput }
  | { kind: 'write_personal_skill'; output: WritePersonalSkillToolOutput }
  | { kind: 'delete_personal_skill'; output: DeletePersonalSkillToolOutput }
  | { kind: 'agent'; output: AgentToolOutput }
  | { kind: 'list_awaiters'; output: ListAwaitersToolOutput }
  | { kind: 'read_awaiter'; output: ReadAwaiterToolOutput }
  | { kind: 'write_awaiter'; output: WriteAwaiterToolOutput }
  | { kind: 'delete_awaiter'; output: DeleteAwaiterToolOutput }
  | { kind: 'list_proactive_tasks'; output: ListProactiveTasksToolOutput }
  | { kind: 'read_proactive_task'; output: ReadProactiveTaskToolOutput }
  | { kind: 'write_proactive_task'; output: WriteProactiveTaskToolOutput }
  | { kind: 'delete_proactive_task'; output: DeleteProactiveTaskToolOutput }
  | { kind: 'unknown'; output: unknown };

const TOOL_SCHEMAS: Record<ToolPayloadKind, { input: z.ZodTypeAny; output: z.ZodTypeAny }> = {
  web: { input: WebToolInputSchemaUi, output: WebToolOutputSchema },
  fetch: { input: FetchToolInputSchemaUi, output: FetchToolOutputSchema },
  shell: { input: ShellToolInputSchemaUi, output: ShellToolOutputSchema },
  read_file: { input: ReadFileInputSchemaUi, output: ReadFileOutputSchema },
  write_file: { input: WriteFileInputSchemaUi, output: WriteFileOutputSchema },
  edit: { input: EditFileInputSchemaUi, output: EditFileOutputSchema },
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
  agent: { input: AgentToolInputSchemaUi, output: AgentToolOutputSchema },
  list_awaiters: { input: ListAwaitersInputSchemaUi, output: ListAwaitersOutputSchema },
  read_awaiter: { input: ReadAwaiterInputSchemaUi, output: ReadAwaiterOutputSchema },
  write_awaiter: { input: WriteAwaiterInputSchemaUi, output: WriteAwaiterOutputSchema },
  delete_awaiter: { input: DeleteAwaiterInputSchemaUi, output: DeleteAwaiterOutputSchema },
  list_proactive_tasks: {
    input: ListProactiveTasksInputSchemaUi,
    output: ListProactiveTasksOutputSchema,
  },
  read_proactive_task: {
    input: ReadProactiveTaskInputSchemaUi,
    output: ReadProactiveTaskOutputSchema,
  },
  write_proactive_task: {
    input: WriteProactiveTaskInputSchemaUi,
    output: WriteProactiveTaskOutputSchema,
  },
  delete_proactive_task: {
    input: DeleteProactiveTaskInputSchemaUi,
    output: DeleteProactiveTaskOutputSchema,
  },
};

const validateInputPayload: ToolPayloadValidator = (kind, normalizedValue) => {
  const parsed = TOOL_SCHEMAS[kind].input.safeParse(normalizedValue);
  return parsed.success ? parsed.data : null;
};

const validateOutputPayload: ToolPayloadValidator = (kind, normalizedValue) => {
  const parsed = TOOL_SCHEMAS[kind].output.safeParse(normalizedValue);
  return parsed.success ? parsed.data : null;
};

export const parseToolInput = (toolName: string, value: unknown): ParsedToolInput => {
  const { kind, payload } = parseToolInputPayload(toolName, value, validateInputPayload);

  return kind === 'unknown'
    ? { kind: 'unknown', input: payload }
    : ({ kind, input: payload } as ParsedToolInput);
};

export const parseToolOutput = (toolName: string, value: unknown): ParsedToolOutput => {
  const { kind, payload } = parseToolOutputPayload(toolName, value, validateOutputPayload);

  return kind === 'unknown'
    ? { kind: 'unknown', output: payload }
    : ({ kind, output: payload } as ParsedToolOutput);
};
