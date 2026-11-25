import { z } from 'zod';

export const SwarmWorkspaceModeSchema = z.enum(['inherit', 'share', 'branch']);

export const SwarmToolInputSchema = z.object({
  action: z
    .enum(['status', 'board', 'models', 'add', 'post', 'model', 'kill', 'title'])
    .describe('Swarm action: status, board, models, add, post, model, kill, or title.'),
  name: z
    .string()
    .optional()
    .describe(
      'Worker roster name for add, model, or kill (base name when n > 1 or tasks is set; lowercase a-z, 0-9, -, _ up to 24 chars).'
    ),
  brief: z
    .string()
    .optional()
    .describe('Worker assignment for add: what it owns and what done looks like. Posted publicly on the shared board.'),
  message: z
    .string()
    .optional()
    .describe('Board message content for post. Include @member or @all mentions to wake teammates.'),
  workspace: SwarmWorkspaceModeSchema.optional().describe(
    'Workspace mode for add: inherit (default, shared read-only/verifier), share (isolated Git worktree), or branch (isolated Git clone).'
  ),
  model: z
    .string()
    .optional()
    .describe('Model identifier (e.g. providerId/model or model) for add or model actions.'),
  fork: z
    .string()
    .optional()
    .describe('Optional existing member name (or "coordinator") whose conversation history the new worker forks from.'),
  n: z
    .number()
    .int()
    .min(1)
    .max(12)
    .optional()
    .describe('Number of homogeneous worker copies (<name>-1..<name>-<n>) to spawn for add.'),
  tasks: z
    .array(z.string().min(1))
    .optional()
    .describe('Per-worker task slices for add when spawning a sharded group (<name>-1..<name>-<len>).'),
  title: z.string().optional().describe('Short swarm title for the title action (coordinator only).'),
  reason: z.string().optional().describe('Short explanation for switching a member model.'),
  all: z.boolean().optional().describe('For models: list every available enabled model.'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe('For board: maximum number of recent board entries to return (default 20).'),
  deleteBranch: z
    .boolean()
    .optional()
    .describe('For kill: also delete the worker local Git branch after removing its worktree.'),
});

export type SwarmToolInput = z.infer<typeof SwarmToolInputSchema>;
