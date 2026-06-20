import type { ModelMessage } from 'ai';

import type { AgentStep, HandoffStep } from '@iki/core/agent/agent_step';
import type { AgentResult } from '@iki/core/agent/types';

import { createSimpleAgentRunner } from '../runners/simple_agent_runner';
import { resolveTools } from './tool_resolver';
import {
  getToolRuntimeContext,
  bindToolRuntimeContextToGenerator,
} from '../../tools/runtime_context';
import type { AgentRunTracker } from '../../agent_session/run_tracker';
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
    });

    const runner = createSimpleAgentRunner({
      enabled: true,
      providerType: this.config_.providerType,
      providerId: this.config_.providerId,
      model: this.config_.model,
      systemPrompt: this.config_.systemPrompt,
      enableTools: tools.length > 0,
      maxIterations: this.config_.maxIterations,
      maxTokens: this.config_.maxOutputTokens,
      ...(this.config_.prepareStep ? { prepareStep: this.config_.prepareStep as any } : {}),
      ...(this.config_.modelFactory ? { modelFactory: this.config_.modelFactory } : {}),
    });

    this.activeRunner = runner;
    this.runTracker = input.runTracker ?? null;

    const agentGen = runner.run({
      config: {
        enabled: true,
        providerType: this.config_.providerType,
        model: this.config_.model,
        enableTools: tools.length > 0,
      },
      prompt: input.prompt,
      tools,
      providerType: this.config_.providerType,
      providerId: this.config_.providerId,
      model: this.config_.model,
      history: input.history ?? this.history,
      ...(this.config_.maxOutputTokens
        ? { maxTokens: this.config_.maxOutputTokens }
        : {}),
      maxIterations: this.config_.maxIterations,
      abortSignal: input.abortSignal,
    });

    // Preserve caller's runtime context across generator iterations
    const ctx = getToolRuntimeContext();
    const boundGen = bindToolRuntimeContextToGenerator(ctx, agentGen);

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
      this.activeRunner = null;
    }

    // Sync history from runner
    const newHistory = runner.getHistory?.() ?? [];
    this.history = cloneModelMessages(newHistory);

    this.runTracker?.syncModelMessages(this.history);

    // Build turn output
    const output: TurnOutput = {
      text: agentResult?.response ?? '',
      usage: agentResult?.usage,
      requiresApproval: agentResult?.requiresApproval ?? false,
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

  steer(message: string): void {
    this.activeRunner?.steer(message);
  }

  getHistory(): ModelMessage[] {
    return cloneModelMessages(this.history);
  }

  getRunTracker(): AgentRunTracker | null {
    return this.runTracker;
  }

  reconfigure(partial: Partial<HarnessConfig>): void {
    this.config_ = { ...this.config_, ...partial };
  }
}
