import { z } from 'zod';

import {
  DEFAULT_AGENT_MAX_ITERATIONS,
  MAX_AGENT_MAX_ITERATIONS,
  MAX_AGENT_TOOL_SELECTION,
  toolCallDescriptionField,
  uiSchema,
} from './shared';

// Defined here but consumed by the output schemas in ./outputs.
export const agentUsedToolOutputSchema = z
  .object({
    name: z.string().optional(),
    callCount: z.number().optional(),
  })
  .passthrough();

// ---------------------------------------------------------------------------
// Agent (sub-agent) tool schemas
// ---------------------------------------------------------------------------

const agentToolInputShape = {
  task: z
    .string()
    .trim()
    .min(1)
    .describe(
      'Self-contained delegated subtask with a clear boundary and deliverable. Use for focused research, review, or synthesis work, not for the entire user request.'
    ),
  context: z
    .string()
    .trim()
    .describe(
      'Optional relevant background, constraints, scope, or already-known facts the subagent must honor.'
    )
    .optional(),
  expectedOutput: z
    .string()
    .trim()
    .describe(
      'Optional exact output contract for the parent agent, for example findings bullets, a shortlist, a comparison summary, or recommended next files.'
    )
    .optional(),
  subagent_type: z
    .enum(['general', 'explorer'])
    .optional()
    .default('general')
    .describe(
      "general (default): full approval-free tool set for open-ended subtasks. explorer: read-only research agent — reads files, searches the web, and loads skills; it cannot create, modify, or delete anything. Use explorer for investigation subtasks so nothing can be changed by accident."
    ),
  tools: z
    .array(z.string().trim().min(1))
    .max(MAX_AGENT_TOOL_SELECTION)
    .describe(
      `Optional exact subset of currently enabled approval-free tools to expose to the delegated subagent. Narrow this when the subtask only needs a few safe tools. Provide at most ${MAX_AGENT_TOOL_SELECTION} tool names.`
    )
    .optional(),
  maxIterations: z
    .number()
    .int()
    .min(1)
    .max(MAX_AGENT_MAX_ITERATIONS)
    .describe(
      `Maximum delegated tool/reasoning steps (1-${MAX_AGENT_MAX_ITERATIONS}). Keep this proportional to the bounded subtask.`
    )
    .optional()
    .default(DEFAULT_AGENT_MAX_ITERATIONS),
  description: toolCallDescriptionField,
};

export const AgentToolInputSchema = z.object(agentToolInputShape);
export const AgentToolInputSchemaUi = uiSchema(agentToolInputShape);
