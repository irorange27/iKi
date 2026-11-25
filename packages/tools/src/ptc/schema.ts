import { z } from 'zod';

export const PtcToolInputSchema = z.object({
  code: z
    .string()
    .min(1)
    .describe(
      'Async JavaScript or TypeScript function body executed in a sandboxed runtime. You can use top-level `await`, `return <value>`, `console.log(...)`, `workspace`, `sleep(ms)`, and `tools` (`tools.list()`, `await tools.call(name, args)`, or shorthand `await tools.<toolName>(args)` for built-in and connected MCP tools).'
    ),
  language: z
    .enum(['ts', 'js'])
    .optional()
    .describe('Script language: "ts" (default, strips TypeScript types) or "js".'),
  timeoutMs: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('Execution timeout in milliseconds (clamped by [tools.ptc].maxTimeoutMs).'),
  description: z
    .string()
    .optional()
    .describe('Short human-readable summary of what this script orchestrates.'),
});

export type PtcToolInput = z.infer<typeof PtcToolInputSchema>;
