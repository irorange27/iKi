import type { ModelMessage } from 'ai';

import { SimpleAgent } from '../../iki_simple_agent';
import { convertModelMessagesToAgentMessages } from '../model_messages';
import type { AgentResult, AgentTool, PartialAgentConfig } from '../types';
import type { ConversationRunner, ConversationRunnerStreamOptions } from './conversation_runner';

export class SimpleConversationRunner implements ConversationRunner {
  private readonly agent: SimpleAgent;

  constructor(config?: PartialAgentConfig) {
    this.agent = new SimpleAgent(config);
  }

  registerTool(tool: AgentTool): void {
    this.agent.registerTool(tool);
  }

  setModelMessages(messages: ModelMessage[]): void {
    this.agent.setMessages(convertModelMessagesToAgentMessages(messages));
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
