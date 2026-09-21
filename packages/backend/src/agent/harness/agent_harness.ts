import { normalizeLanguageModelUsage } from '../../provider/llm/usage';
import type { ModelMessage } from 'ai';

import type { AgentStep, HandoffStep } from '@iki/backend/agent/agent_step';
import type { AgentResult } from '@iki/backend/agent/types';

import { createSimpleAgentRunner } from '../runners/simple_agent_runner';
import { resolveTools } from './tool_resolver';
import {
  getToolRuntimeContext,
  bindToolRuntimeContextToGenerator,
} from '../../utils/runtime_context';
import type { AgentRunTracker } from '../../turn_prep/run_tracker';
import type { HarnessConfig, TurnInput, TurnOutput, TurnEvent } from './harness_types';

export const cloneModelMessages = (messages?: ModelMessage[]): ModelMessage[] => {
  if (!messages || messages.length === 0) return [];
  return structuredClone(messages);
};

export class AgentHarness {
  private config_: HarnessConfig;
  private history: ModelMessage[] = [];
  private runTracker: AgentRunTracker | null = null;
  private activeRunner: ReturnType<typeof createSimpleAgentRunner> | null = null;

  constructor(config: HarnessConfig) {
    this.config_ = config;
  }

  // ── Public API ──────────────────────────────────────────────────────

  async *turn(input: TurnInput): AsyncGenerator<TurnEvent, void> {
    const tools = input.toolsOverride ?? resolveTools({
      enableTools: this.config_.enableTools,
      enabledToolNames: this.config_.enabledToolNames,
      availableSkillIds: this.config_.availableSkillIds,
      guardActive: this.config_.guardActive,
      requireApproval: this.config_.requireApproval ?? this.config_.guardActive,
      autoApproveToolRequests: this.config_.autoApproveToolRequests ?? false,
      ...(this.config_.approvalPolicy ? { approvalPolicy: this.config_.approvalPolicy } : {}),
    });

    const runner = createSimpleAgentRunner({ modelFactory: this.config_.modelFactory });

    this.activeRunner = runner;
    this.runTracker = input.runTracker ?? null;

    const agentGen = runner.run({
      config: {
        enabled: true,
        enableTools: tools.length > 0,
      },
      prompt: input.prompt,
      tools,
      providerType: this.config_.providerType,
      providerId: this.config_.providerId,
      model: this.config_.model,
      history: input.history ?? this.history,
      systemPrompt: this.config_.systemPrompt,
      maxInputTokens: this.config_.maxInputTokens,
      ...(this.config_.threadId ? { threadId: this.config_.threadId } : {}),
      ...(this.config_.reasoningEffort ? { reasoningEffort: this.config_.reasoningEffort } : {}),
      ...(this.config_.maxOutputTokens
        ? { maxTokens: this.config_.maxOutputTokens }
        : {}),
      maxIterations: this.config_.maxIterations,
      abortSignal: input.abortSignal,
      onModelStep: (step, messages, systemPrompt) => input.runTracker?.recordModelStep?.(
        { messages, systemPrompt },
        { inference: true, content: step.content, finishReason: step.finishReason, usage: normalizeLanguageModelUsage(step.usage) },
      ),
    });

    // Preserve caller's runtime context across generator iterations
    const ctx = getToolRuntimeContext();
    const boundGen = bindToolRuntimeContextToGenerator({ ...ctx, availableTools: tools, availableSkillIds: this.config_.availableSkillIds }, agentGen);

    let handoffData: HandoffStep | null = null;
    let agentResult: AgentResult | undefined;

    try {
      let next = await boundGen.next();
      while (!next.done) {
        const step = next.value as AgentStep;

        if (step.type === 'handoff') {
          handoffData = step;
        }

        yield { event: 'step', step };
        next = await boundGen.next();
      }
      agentResult = next.value as AgentResult | undefined;
    } finally {
      if (!agentResult) {
        runner.cancel();
        await boundGen.return(undefined as never);
      }
      this.activeRunner = null;
      this.history = cloneModelMessages(runner.getHistory());
      this.runTracker?.syncModelMessages(this.history);
    }

    // Build turn output
    const output: TurnOutput = {
      text: agentResult?.response ?? '',
      usage: agentResult?.usage,
      ...(agentResult?.perf ? { perf: agentResult.perf } : {}),
      requiresApproval: agentResult?.requiresApproval ?? false,
      finishReason: agentResult?.finishReason,
      ...(agentResult?.toolCalls
        ? { toolCalls: agentResult.toolCalls }
        : {}),
      ...(agentResult?.toolApprovalRequests
        ? { toolApprovalRequests: agentResult.toolApprovalRequests }
        : {}),
      ...(handoffData
        ? {
            handoff: {
              summary: handoffData.summary,
              nextSteps: handoffData.nextSteps,
              reason: handoffData.reason,
            },
          }
        : {}),
    };

    yield { event: 'done', output };
  }

  cancel(): void {
    this.activeRunner?.cancel();
  }

  getHistory(): ModelMessage[] {
    return cloneModelMessages(this.history);
  }

}
