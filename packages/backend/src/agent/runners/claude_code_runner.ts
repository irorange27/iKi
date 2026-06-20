import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';

import { createLogger } from '@iki/backend/logger';
import { getErrorMessage } from '@iki/backend/utils/errors';
import { normalizeLanguageModelUsage } from '../../provider/llm/usage';
import type { AgentRunner, AgentRunnerRequest } from '@iki/backend/agent/runners/agent_runner';
import type { AgentResult, AgentUsage } from '@iki/backend/agent/types';
import type {
  AgentStep,
  MessageUpdateStep,
  ToolExecutionStartStep,
  ToolExecutionEndStep,
  TurnEndStep,
} from '@iki/backend/agent/agent_step';

const logger = createLogger({ module: 'claude_code_runner' });

/**
 * Rough shapes of Claude Code's stream-json output lines.
 * Only the fields we consume are declared; the real format is richer.
 */
interface CcAssistantContentBlock {
  type: 'text' | 'tool_use' | 'tool_result';
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: unknown;
}

interface CcMessage {
  role: 'assistant' | 'user';
  content: CcAssistantContentBlock[];
}

interface CcStreamEvent {
  type: 'assistant' | 'user' | 'result' | 'error';
  message?: CcMessage;
  result?: string;
  usage?: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
  error?: string;
}

const CLAUDE_CLI = 'claude';

const EMPTY_USAGE: AgentUsage = {
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  reasoningTokens: 0,
  estimatedCostUsd: 0,
};

const mapCcUsage = (usage?: CcStreamEvent['usage']): AgentUsage => {
  if (!usage) return { ...EMPTY_USAGE };
  const inputTokens = usage.input_tokens ?? 0;
  const outputTokens = usage.output_tokens ?? 0;
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    cacheReadTokens: usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
    reasoningTokens: 0,
    estimatedCostUsd: 0,
  };
};

export class ClaudeCodeRunner implements AgentRunner {
  private child: ChildProcess | null = null;

  cancel(): void {
    if (this.child) {
      this.child.kill('SIGTERM');
      this.child = null;
    }
  }

  steer(_message: string): void {
    // Steering a CLI agent mid-run is not directly supported.
    // We cancel the current run so the caller can restart with the steer message.
    this.cancel();
  }

  async *run(request: AgentRunnerRequest): AsyncGenerator<AgentStep, AgentResult> {
    const args = ['-p', request.prompt, '--print', '--output-format', 'stream-json'];

    // Append tools as allowed tools if provided
    if (request.tools.length > 0) {
      const toolNames = request.tools.map(t => t.name).join(',');
      args.push('--allowedTools', toolNames);
    }

    // Append model if specified
    if (request.model) {
      args.push('--model', request.model);
    }

    logger.event({
      level: 'info',
      event: 'cc_runner.spawn',
      outcome: 'started',
      data: { args },
    });

    this.child = spawn(CLAUDE_CLI, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    });

    const rl = createInterface({ input: this.child.stdout! });
    let accumulatedText = '';
    let cumulativeUsage: AgentUsage = { ...EMPTY_USAGE };
    let hadError = false;

    try {
      for await (const line of rl) {
        if (!line.trim()) continue;

        let event: CcStreamEvent;
        try {
          event = JSON.parse(line) as CcStreamEvent;
        } catch {
          // Non-JSON lines (e.g. progress spinners) are skipped
          continue;
        }

        if (event.type === 'error') {
          hadError = true;
          yield {
            type: 'turn_end',
            outcome: 'error',
            text: '',
            message: event.error ?? 'Claude Code CLI reported an error',
          } satisfies TurnEndStep;
          continue;
        }

        if (event.type === 'assistant' && event.message) {
          for (const block of event.message.content) {
            if (block.type === 'text' && block.text) {
              accumulatedText += block.text;
              yield {
                type: 'message_update',
                text: block.text,
                kind: 'text',
              } satisfies MessageUpdateStep;
            }

            if (block.type === 'tool_use' && block.name) {
              yield {
                type: 'tool_execution_start',
                toolCallId: block.id ?? `cc-${block.name}-${Date.now()}`,
                toolName: block.name,
                input: block.input ?? {},
              } satisfies ToolExecutionStartStep;
            }
          }
          continue;
        }

        if (event.type === 'user' && event.message) {
          for (const block of event.message.content) {
            if (block.type === 'tool_result' && block.tool_use_id) {
              yield {
                type: 'tool_execution_end',
                toolCallId: block.tool_use_id,
                outcome: 'success',
                output: block.content,
              } satisfies ToolExecutionEndStep;
            }
          }
          continue;
        }

        if (event.type === 'result') {
          const usage = mapCcUsage(event.usage);

          if (!hadError) {
            cumulativeUsage = {
              inputTokens: (cumulativeUsage.inputTokens ?? 0) + (usage.inputTokens ?? 0),
              outputTokens: (cumulativeUsage.outputTokens ?? 0) + (usage.outputTokens ?? 0),
              totalTokens: (cumulativeUsage.totalTokens ?? 0) + (usage.totalTokens ?? 0),
              cacheReadTokens:
                (cumulativeUsage.cacheReadTokens ?? 0) + (usage.cacheReadTokens ?? 0),
              cacheWriteTokens:
                (cumulativeUsage.cacheWriteTokens ?? 0) + (usage.cacheWriteTokens ?? 0),
              reasoningTokens:
                (cumulativeUsage.reasoningTokens ?? 0) + (usage.reasoningTokens ?? 0),
              estimatedCostUsd:
                (cumulativeUsage.estimatedCostUsd ?? 0) + (usage.estimatedCostUsd ?? 0),
            };
          }

          const finalText = event.result ?? accumulatedText;

          yield {
            type: 'turn_end',
            outcome: 'completed',
            text: finalText,
            usage: cumulativeUsage,
          } satisfies TurnEndStep;

          this.child = null;
          return {
            response: finalText,
            usage: cumulativeUsage,
            iterations: 1,
          };
        }
      }
    } catch (error) {
      if (this.child === null) {
        // Already handled (cancel called)
        throw new Error('Run cancelled');
      }
      const errorStep: TurnEndStep = {
        type: 'turn_end',
        outcome: 'error',
        text: '',
        message: getErrorMessage(error),
      };
      yield errorStep;
      throw error;
    }

    // Wait for child to exit and check exit code
    const exitCode = await new Promise<number | null>(resolve => {
      this.child?.on('close', resolve);
    });

    this.child = null;

    if (exitCode !== 0 && exitCode !== null) {
      const errorStep: TurnEndStep = {
        type: 'turn_end',
        outcome: 'error',
        text: '',
        message: `Claude Code CLI exited with code ${exitCode}`,
      };
      yield errorStep;
      throw new Error(`Claude Code CLI exited with code ${exitCode}`);
    }

    const finalText = accumulatedText;

    yield {
      type: 'turn_end',
      outcome: 'completed',
      text: finalText,
      usage: cumulativeUsage,
    } satisfies TurnEndStep;

    return {
      response: finalText,
      usage: cumulativeUsage,
      iterations: 1,
    };
  }
}

export const createClaudeCodeRunner = (): AgentRunner => new ClaudeCodeRunner();
