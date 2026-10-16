import { version } from '../../../../package.json';
import { isObjectRecord } from '../utils/guards';
import { z } from 'zod';
import * as agentRunDb from '@iki/backend/db/agent_runs';
import type { AgentRun, AgentRunStep } from '@iki/backend/types/agent_run';
import type {
  AtifMetrics,
  AtifObservation,
  AtifStep,
  AtifToolCall,
  AtifTrajectory,
  AtifTrajectoryExportResult,
} from '@iki/backend/types/atif';
import { extractTextFromModelMessageContent } from '@iki/backend/agent/model_messages';
import { stripInjectedContext } from '@iki/backend/turn_prep/context_helpers';

/**
 * Exporter for the Agent Trajectory Interchange Format (ATIF, v1.8) —
 * https://www.harborframework.com/docs/agents/trajectory-format
 *
 * Source records: the run row (working.modelMessages / output.usage) and its
 * append-only agent_run_steps audit log. Tool-call steps are merged with their
 * following tool-result step into a single agent step with an observation.
 */

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
    if (text.trim()) return clip(stripInjectedContext(text));
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

  // Observations are indexed by the INFERENCE each audit step follows, not by
  // call id alone. Provider call ids are only unique within a response, so a
  // run-wide map would let a later turn's result answer an earlier turn's call
  // whenever an endpoint reuses ids (`call_1` and friends) — attributing a
  // result to a call that never produced it, which still validates and is
  // therefore silent. `null` keys the audit steps of a run with no inference
  // record (the legacy fallback).
  // Observations are matched to the call they belong to, in BOTH recorded
  // orderings, and never across two calls that share a call id.
  //
  // Providers only guarantee call ids within a single response, so the same
  // id recurs freely across inferences (compat/self-hosted endpoints use
  // `call_1` and friends). The two supplies also record a step's events in
  // OPPOSITE order relative to the inference:
  //   - Pi records the inference first (assistant parts only), then the tool
  //     audit step — the result FOLLOWS its inference.
  //   - The AI SDK emits tool parts DURING the stream and the inference record
  //     at the step's end — the result PRECEDES its inference.
  // Position therefore cannot decide the owner; the call id inside each
  // inference can. Each audit step belongs to whichever inference recorded
  // ITS call id — for a call id that appears once, unambiguously; for one
  // that recurs, the audit step belongs to the inference it sits adjacent to
  // (the inference immediately preceding it, or the inference immediately
  // following it when none precedes).
  const observationsByInferenceAndCall = new Map<string, AtifStep['observation']>();
  const observationsByCallId = new Map<string, AtifStep['observation']>();
  const observationKey = (inferenceStepId: string, callId: string) => `${inferenceStepId}\u0000${callId}`;

  const indexedInferences = orderedSteps.filter(
    step => step.type === 'model' && stepOutput(step).inference === true
  );
  /** Call ids each inference records. */
  const inferenceCallIds = new Map<string, Set<string>>(
    indexedInferences.map(step => {
      const content = stepOutput(step).content;
      const ids = Array.isArray(content)
        ? content.filter(isObjectRecord)
            .filter(part => part.type === 'tool-call' && typeof part.toolCallId === 'string')
            .map(part => String(part.toolCallId))
        : [];
      return [step.id, new Set(ids)] as [string, Set<string>];
    })
  );

  /** The inference an audit step at `index` belongs to: the previous
   *  inference if this call id is not one it recorded is impossible — so the
   *  previous inference wins when it recorded the id, otherwise the next one
   *  does; a call id no inference recorded falls back to the flat map. */
  const ownerInferenceForAuditStep = (callId: string, index: number): string | null => {
    const previous = indexedInferences[index - 1];
    if (previous && inferenceCallIds.get(previous.id)?.has(callId)) return previous.id;
    const next = indexedInferences[index];
    if (next && inferenceCallIds.get(next.id)?.has(callId)) return next.id;
    return null;
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
      observationsByInferenceAndCall.set(observationKey(ownerInference, callId), observation);
    } else {
      // Only the first observation per call id: a second one for the same id
      // has no inference to anchor it, and last-write-wins would answer an
      // earlier call with a later result.
      if (!observationsByCallId.has(callId)) observationsByCallId.set(callId, observation);
    }
  }

  /** The observation recorded for a call, looked up under the inference that
   *  made it and then by call id. The scoped entry is checked first so a
   *  reused id resolves within its own inference rather than answering an
   *  earlier call with a later result. */
  const observationFor = (inferenceStepId: string | null, callId: string) =>
    inferenceStepId
      ? (observationsByInferenceAndCall.get(observationKey(inferenceStepId, callId)) ??
         observationsByCallId.get(callId))
      : observationsByCallId.get(callId);

  /** Whether some inference step already carries this call's observation, so a
   *  later audit step for the same call would duplicate it. */
  const observationClaimedByInference = (callId: string): boolean => {
    for (const inferenceStepId of inferenceCallIds.keys()) {
      if (observationsByInferenceAndCall.has(observationKey(inferenceStepId, callId))) return true;
    }
    return false;
  };

  /** Whether a legacy `tool-call` audit step will emit this call (and so
   *  consume its observation). Only the no-inference shape has these. */
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

    // An audit step whose observation was already joined into an inference
    // step must not be emitted twice. The scoped map is consulted for every
    // inference that recorded this call id, and the flat map covers the
    // shape where no inference ever claimed it.
    if (step.type === 'tool-result' || (step.type === 'error' && stepInput(step).toolCallId)) {
      // The observation is emitted by the step that owns the CALL — either the
      // inference that recorded it, or the legacy `tool-call` step below — so
      // this audit step is a duplicate and drops out. Non-consuming: the
      // emitter decides on its own whether the observation exists.
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
      // An observation is paired with its call from EITHER source: the result
      // parts this inference already carries, or the separate tool-audit step
      // the run recorded. The Pi harness stores the result in that audit step
      // only, so reading just the inference content silently drops every
      // observation of a Pi turn.
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

    // 'model' | 'finalize'
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

/**
 * Structural validation mirroring Harbor's trajectory validator: sequential
 * step ids from 1, ISO timestamps, agent-only fields on agent steps, and
 * observation results that reference a tool call of the same step.
 */
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
