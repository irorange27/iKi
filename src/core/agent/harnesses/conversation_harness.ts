import type { ToolRuntimeContext } from '../../tools/runtime_context';
import {
  bindToolRuntimeContextToGenerator,
  runWithToolRuntimeContext,
} from '../../tools/runtime_context';
import type { AgentResult, AgentTool } from '../types';
import type {
  ConversationRunner,
  ConversationRunnerGenerateRequest,
  ConversationRunnerStreamRequest,
} from '../runners/conversation_runner';

export interface ConversationHarness {
  registerTool(tool: AgentTool): void;
  getRegisteredTools(): AgentTool[];
  getHistory?(): import('ai').ModelMessage[] | undefined;
  generate(request: ConversationRunnerGenerateRequest): Promise<AgentResult>;
  stream(
    request: ConversationRunnerStreamRequest
  ): AsyncGenerator<string, AgentResult, unknown>;
}

class DefaultConversationHarness implements ConversationHarness {
  private readonly runner: ConversationRunner;
  private readonly toolRuntimeContext: ToolRuntimeContext;
  private readonly registeredTools = new Map<string, AgentTool>();

  constructor(params: {
    runner: ConversationRunner;
    toolRuntimeContext?: ToolRuntimeContext;
    tools?: AgentTool[];
  }) {
    this.runner = params.runner;
    this.toolRuntimeContext = params.toolRuntimeContext ?? {};

    for (const tool of params.tools ?? []) {
      this.registerTool(tool);
    }
  }

  registerTool(tool: AgentTool): void {
    this.runner.registerTool(tool);
    this.registeredTools.set(tool.name, tool);
  }

  getRegisteredTools(): AgentTool[] {
    return Array.from(this.registeredTools.values());
  }

  getHistory(): import('ai').ModelMessage[] | undefined {
    return this.runner.getHistory?.();
  }

  private getEffectiveToolRuntimeContext(): ToolRuntimeContext {
    return {
      ...this.toolRuntimeContext,
      availableTools: this.getRegisteredTools(),
    };
  }

  async generate(request: ConversationRunnerGenerateRequest): Promise<AgentResult> {
    return await runWithToolRuntimeContext(this.getEffectiveToolRuntimeContext(), async () => {
      return await this.runner.generate(request);
    });
  }

  stream(
    request: ConversationRunnerStreamRequest
  ): AsyncGenerator<string, AgentResult, unknown> {
    const context = this.getEffectiveToolRuntimeContext();
    const generator = this.runner.stream(request);
    return bindToolRuntimeContextToGenerator(context, generator);
  }
}

export const createConversationHarness = (params: {
  runner: ConversationRunner;
  toolRuntimeContext?: ToolRuntimeContext;
  tools?: AgentTool[];
}): ConversationHarness => new DefaultConversationHarness(params);
