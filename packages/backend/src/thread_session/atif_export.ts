import { version } from '../../../../package.json';
import { isObjectRecord } from '../utils/guards';
import { z } from 'zod';
import * as agentRunDb from '@iki/backend/db/agent_runs';
import type { AgentRun, AgentRunStep } from '@iki/backend/types/agent_run';
import type {
  AtifStep,
  AtifTrajectory,
  AtifTrajectoryExportResult,
} from '@iki/backend/types/atif';
import { extractTextFromModelMessageContent } from '@iki/backend/agent/model_messages';

const ATIF_SCHEMA_VERSION = 'ATIF-v1.8';
const MAX_MESSAGE_TEXT_CHARS = 20_000;

const AtifMetricsSchema = z.object({
  prompt_tokens: z.number().int().nonnegative().optional(),
  completion_tokens: z.number().int().nonnegative().optional(),
  cached_tokens: z.number().int().nonnegative().optional(),
  cost_usd: z.number().nonnegative().optional(),
});

const AtifToolCallSchema = z.object({
  tool_call_id: z.string(),
  function_name: z.string(),
  arguments: z.unknown().optional(),
});

const AtifObservationSchema = z.object({
  results: z.array(
    z.object({
      source_call_id: z.string(),
      content: z.string(),
    })
  ),
});

const AtifStepSchema = z.object({
  step_id: z.number().int().positive(),
  timestamp: z.string(),
  source: z.enum(['system', 'user', 'agent']),
  model_name: z.string().optional(),
  message: z.string(),
  reasoning_content: z.string().optional(),
  tool_calls: z.array(AtifToolCallSchema).optional(),
  observation: AtifObservationSchema.optional(),
  metrics: AtifMetricsSchema.optional(),
  extra: z.record(z.string(), z.unknown()).optional(),
});

export const AtifTrajectorySchema = z.object({
  schema_version: z.literal(ATIF_SCHEMA_VERSION),
  session_id: z.string().optional(),
  trajectory_id: z.string().optional(),
  agent: z.object({
    name: z.string(),
    version: z.string(),
    model_name: z.string().optional(),
    extra: z.record(z.string(), z.unknown()).optional(),
  }),
  steps: z.array(AtifStepSchema),
  final_metrics: z
    .object({
      total_prompt_tokens: z.number().int().nonnegative().optional(),
      total_completion_tokens: z.number().int().nonnegative().optional(),
      total_cached_tokens: z.number().int().nonnegative().optional(),
      total_cost_usd: z.number().nonnegative().optional(),
      total_steps: z.number().int().nonnegative().optional(),
    })
    .optional(),
  extra: z.record(z.string(), z.unknown()).optional(),
});

export type { AtifStep, AtifTrajectory, AtifTrajectoryExportResult };

const stepInput = (step: AgentRunStep): Record<string, unknown> =>
  step.input && typeof step.input === 'object' ? (step.input as Record<string, unknown>) : {};

const stepOutput = (step: AgentRunStep): Record<string, unknown> =>
  step.output && typeof step.output === 'object' ? (step.output as Record<string, unknown>) : {};

const toolCallIdOf = (step: AgentRunStep): string => {
  const callId = stepInput(step).toolCallId;
  return typeof callId === 'string' && callId ? callId : `${step.stepIndex}`;
};

const clip = (value: string): string =>
  value.length > MAX_MESSAGE_TEXT_CHARS ? `${value.slice(0, MAX_MESSAGE_TEXT_CHARS)}…` : value;

const extractLastUserText = (messages: unknown[] | undefined): string | null => {
  if (!Array.isArray(messages)) return null;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i] as { role?: unknown; content?: unknown } | null;
    if (message?.role !== 'user') continue;
    const content = message.content;
    const text =
      typeof content === 'string'
        ? content
        : content && typeof content === 'object'
          ? extractTextFromModelMessageContent(content)
          : '';

    if (text.trim()) return clip(text);
  }
  return null;
};

const agentUsageMetrics = (usage: unknown): AtifTrajectory['final_metrics'] | undefined => {
  if (!usage || typeof usage !== 'object') return undefined;
  const u = usage as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
  const metrics = {
    total_prompt_tokens: num(u.inputTokens),
    total_completion_tokens: num(u.outputTokens),
    total_cached_tokens: num(u.cacheReadTokens),
    total_cost_usd: num(u.estimatedCostUsd),
  };
  const populated = Object.values(metrics).some(v => v !== undefined);
  return populated ? metrics : undefined;
};

export const buildRunTrajectory = (run: AgentRun, steps: AgentRunStep[]): AtifTrajectory => {
  const orderedSteps = [...steps].sort((a, b) => a.stepIndex - b.stepIndex);
  const modelName = `${run.providerType}${run.providerId ? `/${run.providerId}` : ''}/${run.model}`;

  const trajectorySteps: AtifStep[] = [];
  const userText = extractLastUserText(run.input?.messages);
  trajectorySteps.push(
    userText
      ? { step_id: 1, timestamp: run.createdAt, source: 'user', message: userText }
      : {
          step_id: 1,
          timestamp: run.createdAt,
          source: 'system',
          message: `iKi ${run.kind} run started`,
        }
  );

  const observationsByInferenceAndCall = new Map<string, Array<AtifStep['observation']>>();
  const observationsByCallId = new Map<string, AtifStep['observation']>();
  const observationKey = (inferenceStepId: string, callId: string) => `${inferenceStepId}\u0000${callId}`;

  const indexedInferences = orderedSteps.filter(
    step => step.type === 'model' && stepOutput(step).inference === true
  );

  const inferenceCallCounts = new Map<string, Map<string, number>>(
    indexedInferences.map(step => {
      const content = stepOutput(step).content;
      const parts = Array.isArray(content) ? content.filter(isObjectRecord) : [];
      const counts = new Map<string, number>();
      for (const part of parts) {
        if (part.type !== 'tool-call' || typeof part.toolCallId !== 'string') continue;
        const id = String(part.toolCallId);
        counts.set(id, (counts.get(id) ?? 0) + 1);
      }
      return [step.id, counts] as [string, Map<string, number>];
    })
  );

  const inferencePositionById = new Map<string, number>();
  orderedSteps.forEach((step, position) => {
    if (step.type === 'model' && stepOutput(step).inference === true) {
      inferencePositionById.set(step.id, position);
    }
  });

  const assignedPerOwner = new Map<string, number>();

  const ownerInferenceForAuditStep = (callId: string, index: number): string | null => {
    let bestId: string | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const [stepId, position] of inferencePositionById) {
      const total = inferenceCallCounts.get(stepId)?.get(callId) ?? 0;
      if (total === 0) continue;
      const assigned = assignedPerOwner.get(observationKey(stepId, callId)) ?? 0;
      if (assigned >= total) continue;
      const distance = Math.abs(position - index);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestId = stepId;
      }
    }
    if (bestId) {
      const key = observationKey(bestId, callId);
      assignedPerOwner.set(key, (assignedPerOwner.get(key) ?? 0) + 1);
    }
    return bestId;
  };
  for (const [index, step] of orderedSteps.entries()) {
    if (step.type !== 'tool-result' && !(step.type === 'error' && stepInput(step).toolCallId)) continue;
    const callId = toolCallIdOf(step);
    const output = stepOutput(step);
    const content = 'error' in output ? output.error : (output.output ?? null);
    const observation: AtifStep['observation'] = {
      results: [{ source_call_id: callId, content: typeof content === 'string' ? content : JSON.stringify(content) }],
    };
    const ownerInference = ownerInferenceForAuditStep(callId, index);
    if (ownerInference) {
      const key = observationKey(ownerInference, callId);
      const queue = observationsByInferenceAndCall.get(key) ?? [];
      queue.push(observation);
      observationsByInferenceAndCall.set(key, queue);
    } else {

      if (!observationsByCallId.has(callId)) observationsByCallId.set(callId, observation);
    }
  }

  const observationFor = (inferenceStepId: string | null, callId: string) => {
    if (!inferenceStepId) return observationsByCallId.get(callId);
    const queue = observationsByInferenceAndCall.get(observationKey(inferenceStepId, callId));
    const scoped = queue?.shift();
    if (scoped) return scoped;

    if ((inferenceCallCounts.get(inferenceStepId)?.get(callId) ?? 0) > 0) return undefined;
    return observationsByCallId.get(callId);
  };

  const observationClaimedByInference = (callId: string): boolean => {
    for (const inferenceStepId of inferenceCallCounts.keys()) {
      const queue = observationsByInferenceAndCall.get(observationKey(inferenceStepId, callId));
      if (queue && queue.length > 0) return true;
    }
    return false;
  };

  const stepIndexHasLegacyCallStep = (callId: string, steps: typeof orderedSteps): boolean =>
    steps.some(step => step.type === 'tool-call' && toolCallIdOf(step) === callId);
  const inferences = orderedSteps.filter(step => step.type === 'model' && stepOutput(step).inference === true);
  const recordedCallIds = new Set(inferences.flatMap(step => {
    const content = stepOutput(step).content;
    return Array.isArray(content) ? content.filter(isObjectRecord).flatMap(part =>
      part.type === 'tool-call' && typeof part.toolCallId === 'string' ? [part.toolCallId] : []) : [];
  }));

  for (const step of orderedSteps) {
    const output = stepOutput(step);
    const extra: Record<string, unknown> = { run_step_index: step.stepIndex, run_step_type: step.type };

    if (step.type === 'tool-result' || (step.type === 'error' && stepInput(step).toolCallId)) {

      if (observationClaimedByInference(toolCallIdOf(step))) continue;
      if (stepIndexHasLegacyCallStep(toolCallIdOf(step), orderedSteps)) continue;
    }

    const base = {
      step_id: trajectorySteps.length + 1,
      timestamp: step.startedAt,
      source: 'agent' as const,
    };

    if (inferences.length > 0) {
      if ((step.type === 'tool-call' || step.type === 'tool-result' || step.type === 'error') && recordedCallIds.has(toolCallIdOf(step))) continue;
      if (step.type === 'model' && output.inference !== true) continue;
    }
    if (step.type === 'model' && output.inference === true) {
      const parts = Array.isArray(output.content) ? output.content.filter(isObjectRecord) : [];
      const calls = parts.filter(part => part.type === 'tool-call').map(part => ({
        tool_call_id: String(part.toolCallId), function_name: String(part.toolName), arguments: part.input,
      }));

      const results = calls.flatMap(call => {
        const inContent = parts
          .filter(part =>
            (part.type === 'tool-result' || part.type === 'tool-error') &&
            String(part.toolCallId) === call.tool_call_id
          )
          .map(part => ({
            source_call_id: String(part.toolCallId),
            content: typeof part.output === 'string' ? part.output : JSON.stringify(part.output ?? part.error ?? null),
          }));
        if (inContent.length > 0) return inContent;
        const observed = observationFor(step.id, call.tool_call_id);
        return observed ? observed.results : [];
      });
      const usage = isObjectRecord(output.usage) ? output.usage : {};
      trajectorySteps.push({
        ...base, model_name: modelName,
        message: parts.filter(part => part.type === 'text').map(part => part.text).join(''),
        reasoning_content: parts.filter(part => part.type === 'reasoning').map(part => part.text).join(''),
        ...(calls.length ? { tool_calls: calls } : {}),
        ...(results.length ? { observation: { results } } : {}),
        metrics: {
          prompt_tokens: typeof usage.inputTokens === 'number' ? usage.inputTokens : undefined,
          completion_tokens: typeof usage.outputTokens === 'number' ? usage.outputTokens : undefined,
          cached_tokens: typeof usage.cacheReadTokens === 'number' ? usage.cacheReadTokens : undefined,
        },
        extra,
      });
      continue;
    }

    if (step.type === 'tool-call') {
      const input = stepInput(step);
      const callId = toolCallIdOf(step);
      const observation = observationsByCallId.get(callId);
      if (observation) observationsByCallId.delete(callId);
      trajectorySteps.push({
        ...base,
        model_name: modelName,
        message: step.summary,
        tool_calls: [
          {
            tool_call_id: callId,
            function_name:
              typeof input.toolName === 'string' && input.toolName ? input.toolName : 'tool',
            ...(input.input !== undefined ? { arguments: input.input } : {}),
          },
        ],
        ...(observation ? { observation } : {}),
        extra,
      });
      continue;
    }

    if (step.type === 'tool-result') {
      trajectorySteps.push({
        ...base,
        model_name: modelName,
        message: step.summary,
        extra: { ...extra, unmatched_output: output },
      });
      continue;
    }

    if (step.type === 'error') {
      trajectorySteps.push({
        ...base,
        message: step.summary,
        source: 'system',
        extra: { ...extra, error: output },
      });
      continue;
    }

    if (step.type === 'approval-request') {
      trajectorySteps.push({
        ...base,
        message: step.summary,
        extra: { ...extra, approval_request: stepInput(step) },
      });
      continue;
    }

    if (step.type === 'approval-response') {
      trajectorySteps.push({
        ...base,
        message: step.summary,
        extra: { ...extra, approval_response: stepInput(step) },
      });
      continue;
    }

    if (step.type === 'child-run') {
      trajectorySteps.push({
        ...base,
        message: step.summary,
        extra: { ...extra, child_run: stepInput(step) },
      });
      continue;
    }

    const text = typeof output.text === 'string' ? clip(output.text) : '';
    trajectorySteps.push({
      ...base,
      model_name: modelName,
      ...(text ? { message: text } : { message: step.summary }),
      extra,
    });
  }

  const usageMetrics = agentUsageMetrics(run.output?.usage);
  const finalMetrics = {
    ...usageMetrics,
    total_steps: trajectorySteps.length,
  };

  return {
    schema_version: ATIF_SCHEMA_VERSION,
    session_id: run.id,
    trajectory_id: run.id,
    agent: {
      name: 'iKi',
      version,
      model_name: modelName,
      extra: {
        provider_type: run.providerType,
        ...(run.providerId ? { provider_id: run.providerId } : {}),
        kind: run.kind,
        ...(run.enabledTools.length > 0 ? { enabled_tools: run.enabledTools } : {}),
      },
    },
    steps: trajectorySteps,
    final_metrics: finalMetrics,
    extra: {
      thread_id: run.threadId ?? null,
      status: run.status,
      parent_run_id: run.parentRunId,
      root_run_id: run.rootRunId,
      ...(run.error ? { error: run.error } : {}),
    },
  };
};

export const validateAtifTrajectory = (trajectory: AtifTrajectory): string[] => {
  const errors: string[] = [];
  const parsed = AtifTrajectorySchema.safeParse(trajectory);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      errors.push(`trajectory.${issue.path.join('.')}: ${issue.message}`);
    }
    return errors;
  }

  parsed.data.steps.forEach((step, index) => {
    if (step.step_id !== index + 1) {
      errors.push(
        `trajectory.steps.${index}.step_id: expected ${index + 1} (sequential from 1), got ${step.step_id}`
      );
    }
    if (Number.isNaN(Date.parse(step.timestamp))) {
      errors.push(`trajectory.steps.${index}.timestamp: invalid ISO 8601 timestamp`);
    }
    if (step.source !== 'agent') {
      for (const field of ['model_name', 'reasoning_content', 'tool_calls', 'metrics'] as const) {
        if (step[field] !== undefined) {
          errors.push(`trajectory.steps.${index}.${field}: only allowed on agent steps`);
        }
      }
    }
    const callIds = new Set((step.tool_calls ?? []).map(call => call.tool_call_id));
    for (const [resultIndex, result] of (step.observation?.results ?? []).entries()) {
      if (!callIds.has(result.source_call_id)) {
        errors.push(
          `trajectory.steps.${index}.observation.results.${resultIndex}.source_call_id: references unknown tool call '${result.source_call_id}'`
        );
      }
    }
  });

  return errors;
};

export const exportRunTrajectory = (runId: string): AtifTrajectoryExportResult => {
  const run = agentRunDb.getAgentRun(runId);
  if (!run) return { success: false, errors: [`Run ${runId} not found`] };

  const steps = agentRunDb.listAgentRunSteps(runId);
  const trajectory = buildRunTrajectory(run, steps);
  const errors = validateAtifTrajectory(trajectory);
  return errors.length > 0 ? { success: false, trajectory, errors } : { success: true, trajectory };
};
