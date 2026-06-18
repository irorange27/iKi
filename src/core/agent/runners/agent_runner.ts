import type { ModelMessage } from 'ai';

import type { AgentStep } from '../agent_step';
import type { AgentResult, AgentTool, PartialAgentConfig } from '../types';
import type { ToolApprovalRequest } from '../types';

/**
 * Configuration passed to an AgentRunner when starting a run.
 */
export interface AgentRunnerRequest {
  prompt: string;
  history?: ModelMessage[];
  tools: AgentTool[];

  /** Provider / model selection. */
  providerType: string;
  providerId?: string;
  model: string;

  /** Optional LLM knobs. */
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;

  /** Maximum tool-calling iterations before forced stop. */
  maxIterations?: number;

  /** Signal to cancel the run externally. */
  abortSignal?: AbortSignal;

  /** Additional free-form config overrides. */
  config?: PartialAgentConfig;
}

/**
 * Agent runner — owns the full agent execution cycle.
 *
 * A runner is responsible for:
 * - LLM invocation
 * - Tool execution
 * - Iteration control (retry, max steps, handoff)
 * - Cancellation
 * - Steering (injecting a user message mid-run)
 *
 * The single `run()` method yields `AgentStep` values as the run
 * progresses and returns an `AgentResult` when the run completes.
 */
export interface AgentRunner {
  /**
   * Execute the agent run.
   *
   * Yields structured `AgentStep` events as the run progresses.
   * Returns the final `AgentResult` when the run completes.
   *
   * If the run is cancelled via `cancel()`, the generator throws.
   * If `steer()` is called, the runner restarts with the injected message
   * (implementation-defined behavior per runner).
   */
  run(request: AgentRunnerRequest): AsyncGenerator<AgentStep, AgentResult>;

  /** Cancel the current run. */
  cancel(): void;

  /**
   * Return the current model-message history accumulated by this runner.
   * Returns undefined if history tracking is not supported by this runner
   * (e.g. external CLI runners).
   */
  getHistory?(): ModelMessage[] | undefined;

  /**
   * Inject a user message into a running turn.
   * The runner cancels the current LLM call and restarts with the
   * steer message appended.
   */
  steer(message: string): void;
}

/** Factory signature for creating an AgentRunner. */
export type AgentRunnerFactory = (config?: PartialAgentConfig) => AgentRunner;
