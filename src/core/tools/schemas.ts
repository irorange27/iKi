import { z } from 'zod';

export const DEFAULT_SEARCH_RESULT_LIMIT = 5;
export const MAX_SEARCH_RESULT_LIMIT = 10;
export const DEFAULT_FETCH_MAX_CHARS = 12000;
export const MIN_FETCH_MAX_CHARS = 500;
export const MAX_FETCH_MAX_CHARS = 80000;
export const DEFAULT_SHELL_TIMEOUT_MS = 30000;
export const DEFAULT_FILE_ENCODING = 'utf-8';

const webInputFields = {
  query: z.string().min(1).describe('Search query text'),
  limit: z.number().int().describe('Maximum number of search results'),
};

const fetchInputFields = {
  url: z.string().url().describe('HTTP/HTTPS URL to fetch'),
  maxChars: z.number().int().describe('Maximum number of characters to return from fetched content'),
};

const shellInputFields = {
  command: z.string().describe('The shell command to execute'),
  cwd: z.string().describe('The working directory in which to execute the command'),
  timeout: z.number().describe('Command timeout in milliseconds'),
};

const readFileInputFields = {
  path: z.string().describe('The absolute path to the file to read'),
  encoding: z.string().describe('File encoding'),
};

const writeFileInputFields = {
  path: z.string().describe('The absolute path to the file to write'),
  content: z.string().describe('The content to write to the file'),
  encoding: z.string().describe('File encoding'),
};

const listDirInputFields = {
  path: z.string().describe('The absolute path to the directory to list'),
  recursive: z.boolean().describe('Whether to list subdirectories recursively'),
};

const deleteFileInputFields = {
  path: z.string().describe('The absolute path to the file to delete'),
};

export const WebToolInputSchema = z.object({
  query: webInputFields.query,
  limit: webInputFields.limit.optional().default(DEFAULT_SEARCH_RESULT_LIMIT),
});

export const WebToolInputSchemaUi = z
  .object({
    query: webInputFields.query.optional(),
    limit: webInputFields.limit.optional(),
  })
  .passthrough();

export const FetchToolInputSchema = z.object({
  url: fetchInputFields.url,
  maxChars: fetchInputFields.maxChars.optional().default(DEFAULT_FETCH_MAX_CHARS),
});

export const FetchToolInputSchemaUi = z
  .object({
    url: fetchInputFields.url.optional(),
    maxChars: fetchInputFields.maxChars.optional(),
  })
  .passthrough();

export const ShellToolInputSchema = z.object({
  command: shellInputFields.command,
  cwd: shellInputFields.cwd.optional(),
  timeout: shellInputFields.timeout.optional().default(DEFAULT_SHELL_TIMEOUT_MS),
});

export const ShellToolInputSchemaUi = z
  .object({
    command: shellInputFields.command.optional(),
    cwd: shellInputFields.cwd.optional(),
    timeout: shellInputFields.timeout.optional(),
  })
  .passthrough();

export const ReadFileInputSchema = z.object({
  path: readFileInputFields.path,
  encoding: readFileInputFields.encoding.optional().default(DEFAULT_FILE_ENCODING),
});

export const ReadFileInputSchemaUi = z
  .object({
    path: readFileInputFields.path.optional(),
    encoding: readFileInputFields.encoding.optional(),
  })
  .passthrough();

export const WriteFileInputSchema = z.object({
  path: writeFileInputFields.path,
  content: writeFileInputFields.content,
  encoding: writeFileInputFields.encoding.optional().default(DEFAULT_FILE_ENCODING),
});

export const WriteFileInputSchemaUi = z
  .object({
    path: writeFileInputFields.path.optional(),
    content: writeFileInputFields.content.optional(),
    encoding: writeFileInputFields.encoding.optional(),
  })
  .passthrough();

export const ListDirInputSchema = z.object({
  path: listDirInputFields.path,
  recursive: listDirInputFields.recursive.optional().default(false),
});

export const ListDirInputSchemaUi = z
  .object({
    path: listDirInputFields.path.optional(),
    recursive: listDirInputFields.recursive.optional(),
  })
  .passthrough();

export const DeleteFileInputSchema = z.object({
  path: deleteFileInputFields.path,
});

export const DeleteFileInputSchemaUi = z
  .object({
    path: deleteFileInputFields.path.optional(),
  })
  .passthrough();

export const WebToolOutputSchema = z
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

export const FetchToolOutputSchema = z
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

export const ShellToolOutputSchema = z
  .object({
    stdout: z.string().optional(),
    stderr: z.string().optional(),
    exitCode: z.number().optional(),
    isError: z.boolean().optional(),
  })
  .passthrough();

export const ReadFileOutputSchema = z
  .object({
    path: z.string().optional(),
    content: z.string().optional(),
  })
  .passthrough();

export const WriteFileOutputSchema = z
  .object({
    path: z.string().optional(),
    success: z.boolean().optional(),
  })
  .passthrough();

export const ListDirOutputSchema = z.array(
  z
    .object({
      name: z.string().optional(),
      isDirectory: z.boolean().optional(),
      isFile: z.boolean().optional(),
      path: z.string().optional(),
    })
    .passthrough()
);

export const DeleteFileOutputSchema = z
  .object({
    path: z.string().optional(),
    deleted: z.boolean().optional(),
  })
  .passthrough();
