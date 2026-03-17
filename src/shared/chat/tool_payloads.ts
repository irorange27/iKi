import { z } from 'zod';

import { normalizeToolNameKey } from './tool_parts';


const WebToolInputSchema = z
  .object({
    query: z.string().optional(),
    limit: z.number().optional(),
  })
  .passthrough();

const FetchToolInputSchema = z
  .object({
    url: z.string().optional(),
    maxChars: z.number().optional(),
  })
  .passthrough();

const ShellToolInputSchema = z
  .object({
    command: z.string().optional(),
    cwd: z.string().optional(),
    timeout: z.number().optional(),
  })
  .passthrough();

const ReadFileInputSchema = z
  .object({
    path: z.string().optional(),
    encoding: z.string().optional(),
  })
  .passthrough();

const WriteFileInputSchema = z
  .object({
    path: z.string().optional(),
    content: z.string().optional(),
    encoding: z.string().optional(),
  })
  .passthrough();

const ListDirInputSchema = z
  .object({
    path: z.string().optional(),
    recursive: z.boolean().optional(),
  })
  .passthrough();

const DeleteFileInputSchema = z
  .object({
    path: z.string().optional(),
  })
  .passthrough();

const WebToolOutputSchema = z
  .object({
    query: z.string().optional(),
    source: z.string().optional(),
    results: z
      .array(
        z
          .object({
            title: z.string().optional(),
            url: z.string().optional(),
          })
          .passthrough()
      )
      .optional(),
    resultCount: z.number().optional(),
    warnings: z.array(z.string()).optional(),
    sourcesTried: z.array(z.string()).optional(),
  })
  .passthrough();

const FetchToolOutputSchema = z
  .object({
    url: z.string().optional(),
    finalUrl: z.string().optional(),
    ok: z.boolean().optional(),
    status: z.number().optional(),
    statusText: z.string().optional(),
    contentType: z.string().optional(),
    title: z.string().optional(),
    content: z.string().optional(),
    truncated: z.boolean().optional(),
    error: z.string().optional(),
  })
  .passthrough();

const ShellToolOutputSchema = z
  .object({
    stdout: z.string().optional(),
    stderr: z.string().optional(),
    exitCode: z.number().optional(),
    isError: z.boolean().optional(),
  })
  .passthrough();

const ReadFileOutputSchema = z
  .object({
    path: z.string().optional(),
    content: z.string().optional(),
  })
  .passthrough();

const WriteFileOutputSchema = z
  .object({
    path: z.string().optional(),
    success: z.boolean().optional(),
  })
  .passthrough();

const ListDirOutputSchema = z.array(
  z
    .object({
      name: z.string().optional(),
      isDirectory: z.boolean().optional(),
      isFile: z.boolean().optional(),
      path: z.string().optional(),
    })
    .passthrough()
);

const DeleteFileOutputSchema = z
  .object({
    path: z.string().optional(),
    deleted: z.boolean().optional(),
  })
  .passthrough();

export type WebToolInput = z.infer<typeof WebToolInputSchema>;
export type FetchToolInput = z.infer<typeof FetchToolInputSchema>;
export type ShellToolInput = z.infer<typeof ShellToolInputSchema>;
export type ReadFileToolInput = z.infer<typeof ReadFileInputSchema>;
export type WriteFileToolInput = z.infer<typeof WriteFileInputSchema>;
export type ListDirToolInput = z.infer<typeof ListDirInputSchema>;
export type DeleteFileToolInput = z.infer<typeof DeleteFileInputSchema>;

export type WebToolOutput = z.infer<typeof WebToolOutputSchema>;
export type FetchToolOutput = z.infer<typeof FetchToolOutputSchema>;
export type ShellToolOutput = z.infer<typeof ShellToolOutputSchema>;
export type ReadFileToolOutput = z.infer<typeof ReadFileOutputSchema>;
export type WriteFileToolOutput = z.infer<typeof WriteFileOutputSchema>;
export type ListDirToolOutput = z.infer<typeof ListDirOutputSchema>;
export type DeleteFileToolOutput = z.infer<typeof DeleteFileOutputSchema>;

export type ParsedToolInput =
  | { kind: 'web'; input: WebToolInput }
  | { kind: 'fetch'; input: FetchToolInput }
  | { kind: 'shell'; input: ShellToolInput }
  | { kind: 'read_file'; input: ReadFileToolInput }
  | { kind: 'write_file'; input: WriteFileToolInput }
  | { kind: 'list_dir'; input: ListDirToolInput }
  | { kind: 'delete_file'; input: DeleteFileToolInput }
  | { kind: 'unknown'; input: unknown };

export type ParsedToolOutput =
  | { kind: 'web'; output: WebToolOutput }
  | { kind: 'fetch'; output: FetchToolOutput }
  | { kind: 'shell'; output: ShellToolOutput }
  | { kind: 'read_file'; output: ReadFileToolOutput }
  | { kind: 'write_file'; output: WriteFileToolOutput }
  | { kind: 'list_dir'; output: ListDirToolOutput }
  | { kind: 'delete_file'; output: DeleteFileToolOutput }
  | { kind: 'unknown'; output: unknown };

const parseJsonValue = (value: unknown): unknown => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed) return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
};

const parseWithSchema = <T extends z.ZodTypeAny>(
  schema: T,
  value: unknown
): z.infer<T> | null => {
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : null;
};

export const parseToolInput = (toolName: string, value: unknown): ParsedToolInput => {
  const toolKey = normalizeToolNameKey(toolName);
  const normalizedValue =
    typeof value === 'object' && value !== null ? value : parseJsonValue(value);

  switch (toolKey) {
    case 'web':
    case 'web_search': {
      const parsed = parseWithSchema(WebToolInputSchema, normalizedValue);
      return parsed ? { kind: 'web', input: parsed } : { kind: 'unknown', input: value };
    }
    case 'fetch': {
      const parsed = parseWithSchema(FetchToolInputSchema, normalizedValue);
      return parsed ? { kind: 'fetch', input: parsed } : { kind: 'unknown', input: value };
    }
    case 'shell': {
      const parsed = parseWithSchema(ShellToolInputSchema, normalizedValue);
      return parsed ? { kind: 'shell', input: parsed } : { kind: 'unknown', input: value };
    }
    case 'read_file': {
      const parsed = parseWithSchema(ReadFileInputSchema, normalizedValue);
      return parsed ? { kind: 'read_file', input: parsed } : { kind: 'unknown', input: value };
    }
    case 'write_file': {
      const parsed = parseWithSchema(WriteFileInputSchema, normalizedValue);
      return parsed ? { kind: 'write_file', input: parsed } : { kind: 'unknown', input: value };
    }
    case 'list_dir': {
      const parsed = parseWithSchema(ListDirInputSchema, normalizedValue);
      return parsed ? { kind: 'list_dir', input: parsed } : { kind: 'unknown', input: value };
    }
    case 'delete_file': {
      const parsed = parseWithSchema(DeleteFileInputSchema, normalizedValue);
      return parsed ? { kind: 'delete_file', input: parsed } : { kind: 'unknown', input: value };
    }
    default:
      return { kind: 'unknown', input: value };
  }
};

export const parseToolOutput = (toolName: string, value: unknown): ParsedToolOutput => {
  const toolKey = normalizeToolNameKey(toolName);
  const normalizedValue = parseJsonValue(value);

  switch (toolKey) {
    case 'web':
    case 'web_search': {
      const parsed = parseWithSchema(WebToolOutputSchema, normalizedValue);
      return parsed ? { kind: 'web', output: parsed } : { kind: 'unknown', output: value };
    }
    case 'fetch': {
      const parsed = parseWithSchema(FetchToolOutputSchema, normalizedValue);
      return parsed ? { kind: 'fetch', output: parsed } : { kind: 'unknown', output: value };
    }
    case 'shell': {
      const parsed = parseWithSchema(ShellToolOutputSchema, normalizedValue);
      return parsed ? { kind: 'shell', output: parsed } : { kind: 'unknown', output: value };
    }
    case 'read_file': {
      const parsed = parseWithSchema(ReadFileOutputSchema, normalizedValue);
      return parsed ? { kind: 'read_file', output: parsed } : { kind: 'unknown', output: value };
    }
    case 'write_file': {
      const parsed = parseWithSchema(WriteFileOutputSchema, normalizedValue);
      return parsed ? { kind: 'write_file', output: parsed } : { kind: 'unknown', output: value };
    }
    case 'list_dir': {
      const parsed = parseWithSchema(ListDirOutputSchema, normalizedValue);
      return parsed ? { kind: 'list_dir', output: parsed } : { kind: 'unknown', output: value };
    }
    case 'delete_file': {
      const parsed = parseWithSchema(DeleteFileOutputSchema, normalizedValue);
      return parsed ? { kind: 'delete_file', output: parsed } : { kind: 'unknown', output: value };
    }
    default:
      return { kind: 'unknown', output: value };
  }
};

export const parseToolPayload = (toolName: string, input: unknown, output: unknown) => ({
  input: parseToolInput(toolName, input),
  output: parseToolOutput(toolName, output),
});
