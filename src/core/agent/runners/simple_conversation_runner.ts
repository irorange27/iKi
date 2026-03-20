import type { ModelMessage } from 'ai';

import { SimpleAgent } from '../../iki_simple_agent';
import { convertModelMessagesToAgentMessages } from '../model_messages';
import type { AgentResult, AgentTool, PartialAgentConfig } from '../types';
import type {
  ConversationRunner,
  ConversationRunnerGenerateRequest,
  ConversationRunnerStreamRequest,
} from './conversation_runner';

export class SimpleConversationRunner implements ConversationRunner {
  private readonly agent: SimpleAgent;

  constructor(config?: PartialAgentConfig) {
    this.agent = new SimpleAgent(config);
  }

  registerTool(tool: AgentTool): void {
    this.agent.registerTool(tool);
  }

  private loadHistory(messages?: ModelMessage[]): void {
    if (messages === undefined) return;

    this.agent.reset();
    if (messages.length > 0) {
      this.agent.setMessages(convertModelMessagesToAgentMessages(messages));
    }
  }

  generate(request: ConversationRunnerGenerateRequest): Promise<AgentResult> {
    this.loadHistory(request.history);
    return this.agent.generate(request.prompt);
  }

  stream(request: ConversationRunnerStreamRequest): AsyncGenerator<string, AgentResult, unknown> {
    this.loadHistory(request.history);
    return this.agent.stream(
      request.prompt,
      request.approvalResponses,
      request.onStreamPart,
      request.abortSignal
    );
  }
}

export const createSimpleConversationRunner = (config?: PartialAgentConfig): ConversationRunner =>
  new SimpleConversationRunner(config);
