import { SimpleAgent } from '../../iki_simple_agent';
import type { AgentMessage, AgentResult, AgentTool, PartialAgentConfig } from '../types';
import type { ConversationRunner, ConversationRunnerStreamOptions } from './conversation_runner';

export class SimpleConversationRunner implements ConversationRunner {
  private readonly agent: SimpleAgent;

  constructor(config?: PartialAgentConfig) {
    this.agent = new SimpleAgent(config);
  }

  registerTool(tool: AgentTool): void {
    this.agent.registerTool(tool);
  }

  setMessages(messages: AgentMessage[]): void {
    this.agent.setMessages(messages);
  }

  generate(prompt: string): Promise<AgentResult> {
    return this.agent.generate(prompt);
  }

  stream(
    prompt: string,
    options: ConversationRunnerStreamOptions = {}
  ): AsyncGenerator<string, AgentResult, unknown> {
    return this.agent.stream(
      prompt,
      options.approvalResponses,
      options.onStreamPart,
      options.abortSignal
    );
  }
}

export const createSimpleConversationRunner = (config?: PartialAgentConfig): ConversationRunner =>
  new SimpleConversationRunner(config);
