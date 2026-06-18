import {
  jsonSchema,
  tool,
  type FlexibleSchema,
  type ModelMessage,
  type Tool,
  type ToolApprovalResponse,
  type ToolSet,
} from 'ai';
import { acpTools } from '@mcpc-tech/acp-ai-provider';

import { getAppConfig } from '@iki/backend/config';
import { createLogger } from '../logger';
import { withRetry } from '../tools/retry';
import { getFullSystemPrompt } from '../provider/llm/factory';
import { ACP_PROVIDER_TYPE } from '../constants/acp';
import { unwrapAcpDynamicToolCall } from '../utils/acp';
import {
  extractTextFromModelMessageContent,
  sanitizeModelConversationMessages,
} from './model_messages';
import {
  AgentConfigSchema,
  type AgentConfig,
  type AgentTool,
  type PartialAgentConfig,
  type ToolApprovalRequest,
} from './types';

const agentRuntimeLogger = createLogger({ module: 'ai_sdk_runtime' });

export const getDefaultAgentConfig = (): AgentConfig =>
  AgentConfigSchema.parse({
    enabled: false,
    systemPrompt: 'You are a helpful AI assistant. You are capable, autonomous, and helpful.',
    providerType: '',
    providerId: '',
    model: '',
    temperature: 0.1,
    maxTokens: 2000,
    maxIterations: 10,
    enableTools: false,
    enableMemory: false,
  });

const getAgentConfigBase = (overrideConfig?: PartialAgentConfig): PartialAgentConfig => {
  try {
    const appConfig = getAppConfig();
    const base = appConfig?.agent || getDefaultAgentConfig();
    return overrideConfig ? { ...base, ...overrideConfig } : base;
  } catch (error) {
    agentRuntimeLogger.event({
      level: 'error',
      event: 'agent.config.load',
      outcome: 'failed',
      error,
    });
    return overrideConfig
      ? { ...getDefaultAgentConfig(), ...overrideConfig }
      : getDefaultAgentConfig();
  }
};

export const loadAgentConfig = (overrideConfig?: PartialAgentConfig): AgentConfig => {
  const baseConfig = getAgentConfigBase(overrideConfig);

  try {
    return AgentConfigSchema.parse(baseConfig);
  } catch (error) {
    agentRuntimeLogger.event({
      level: 'error',
      event: 'agent.config.parse',
      outcome: 'failed',
      error,
      data: {
        source: 'primary',
      },
    });
    try {
      return AgentConfigSchema.parse({
        ...getDefaultAgentConfig(),
        ...(overrideConfig ?? {}),
      });
    } catch (parseError) {
      agentRuntimeLogger.event({
        level: 'error',
        event: 'agent.config.parse',
        outcome: 'degraded',
        error: parseError,
        message: 'Fallback agent config parsing failed; using defaults.',
        data: {
          source: 'fallback',
        },
      });
      return getDefaultAgentConfig();
    }
  }
};

export const validateAgentConfig = (config: AgentConfig): void => {
  try {
    AgentConfigSchema.parse(config);
  } catch (error) {
    throw new Error(
      `Invalid agent configuration: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }

  if (!config.enabled) {
    throw new Error('Agent is not enabled');
  }

  if (!config.providerType || !config.model) {
    throw new Error('Agent provider and model must be configured');
  }
};

export const buildAiToolSet = (
  config: Pick<AgentConfig, 'enableTools' | 'providerType'>,
  registeredTools: AgentTool[]
): ToolSet | undefined => {
  const requiresAcpDynamicTool =
    config.enableTools && config.providerType.trim().toLowerCase() === ACP_PROVIDER_TYPE;

  if (!config.enableTools || (registeredTools.length === 0 && !requiresAcpDynamicTool)) {
    agentRuntimeLogger.event({
      level: 'debug',
      event: 'agent.tools.build',
      outcome: 'skipped',
      message: 'Tools disabled or no tools registered.',
    });
    return undefined;
  }

  const tools: ToolSet = {};
  agentRuntimeLogger.event({
    level: 'debug',
    event: 'agent.tools.build',
    outcome: 'started',
    data: {
      registered_tool_count: registeredTools.length,
    },
  });

  for (const agentTool of registeredTools) {
    const schemaSource = agentTool.paramSchema ? 'zod' : agentTool.parameters ? 'json' : null;
    const inputSchema = agentTool.paramSchema
      ? agentTool.paramSchema
      : agentTool.parameters
        ? jsonSchema(agentTool.parameters as object)
        : null;

    if (schemaSource && inputSchema) {
      try {
        const definition: Tool<unknown, unknown> = {
          description: agentTool.description,
          inputSchema: inputSchema as FlexibleSchema<unknown>,
          ...(agentTool.outputSchema
            ? { outputSchema: jsonSchema(agentTool.outputSchema as object) }
            : {}),
          needsApproval: agentTool.needsApproval,
          execute: agentTool.retry
            ? withRetry(async (input: unknown) => await agentTool.handler(input), agentTool.retry)
            : async (input: unknown) => await agentTool.handler(input),
        };
        const toolDef = tool(definition);

        agentRuntimeLogger.event({
          level: 'debug',
          event: 'agent.tool.prepare',
          outcome: 'succeeded',
          data: {
            tool_name: agentTool.name,
            schema_source: schemaSource,
            has_execute: true,
          },
        });

        tools[agentTool.name] = toolDef;
      } catch (error: unknown) {
        agentRuntimeLogger.event({
          level: 'error',
          event: 'agent.tool.prepare',
          outcome: 'failed',
          error,
          data: {
            tool_name: agentTool.name,
            schema_source: schemaSource,
            ...(schemaSource === 'json' ? { parameters: agentTool.parameters } : {}),
          },
        });
        throw error;
      }
      continue;
    }

    agentRuntimeLogger.event({
      level: 'warn',
      event: 'agent.tool.prepare',
      outcome: 'skipped',
      message: 'Tool has neither parameters nor paramSchema.',
      data: {
        tool_name: agentTool.name,
      },
    });
  }

  agentRuntimeLogger.event({
    level: 'debug',
    event: 'agent.tools.build',
    outcome: 'succeeded',
    data: {
      built_tool_count: Object.keys(tools).length,
      tool_names: Object.keys(tools),
      acp_dynamic_tool: requiresAcpDynamicTool,
    },
  });

  if (requiresAcpDynamicTool) {
    return acpTools(tools);
  }

  return Object.keys(tools).length > 0 ? tools : undefined;
};

export const buildPromptContext = (
  config: Pick<AgentConfig, 'providerType' | 'providerId' | 'systemPrompt'>,
  history: ModelMessage[]
): { systemPrompt: string; messages: ModelMessage[] } => {
  const MAX_MESSAGES = 80;
  const KEEP_RECENT = 40;
  const KEEP_PREFIX = 5;

  const conversationMessages = history.filter(message => message.role !== 'system');
  const sanitizedConversation = sanitizeModelConversationMessages(conversationMessages);
  const sanitized = sanitizedConversation.messages;

  const systemParts: string[] = [getFullSystemPrompt(config.providerType, config.providerId)];

  if (config.systemPrompt.trim()) {
    systemParts.push(config.systemPrompt.trim());
  }

  for (const message of history) {
    if (message.role !== 'system') continue;
    const content = extractTextFromModelMessageContent(message.content).trim();
    if (content) {
      systemParts.push(content);
    }
  }

  // Compaction: when conversation exceeds threshold, keep recent messages + prefix,
  // drop middle, and insert a compaction note so the model knows context was truncated.
  let compactedHistory: ModelMessage[] = sanitized;
  if (sanitized.length > MAX_MESSAGES) {
    const prefix = sanitized.slice(0, KEEP_PREFIX);
    const recent = sanitized.slice(-KEEP_RECENT);
    const droppedCount = sanitized.length - KEEP_PREFIX - KEEP_RECENT;
    compactedHistory = [...prefix, ...recent];

    systemParts.push(
      `[History compacted: ${droppedCount} older messages were dropped to stay within context limits. ` +
      `The first ${KEEP_PREFIX} messages and most recent ${KEEP_RECENT} messages are preserved. ` +
      `If the missing context matters, ask the user or re-read relevant files.]`
    );

    agentRuntimeLogger.event({
      level: 'info',
      event: 'agent.history.compacted',
      outcome: 'degraded',
      data: {
        original_message_count: sanitized.length,
        compacted_message_count: compactedHistory.length,
        dropped_message_count: droppedCount,
      },
    });
  }

  if (sanitizedConversation.droppedMessages > 0) {
    agentRuntimeLogger.event({
      level: 'warn',
      event: 'agent.history.tool_messages_sanitized',
      outcome: 'degraded',
      data: {
        dropped_message_count: sanitizedConversation.droppedMessages,
        message_count_before: conversationMessages.length,
        message_count_after: sanitized.length,
      },
    });
  }

  return {
    systemPrompt: systemParts.join('\n\n'),
    messages: compactedHistory,
  };
};

export const cloneModelMessages = (messages?: ModelMessage[]): ModelMessage[] => {
  if (!messages || messages.length === 0) {
    return [];
  }

  return structuredClone(messages);
};

export const appendUserPromptToHistory = (
  history: ModelMessage[],
  prompt: string
): ModelMessage[] => [
  ...history,
  {
    role: 'user',
    content: prompt,
  },
];

export const appendApprovalResponsesToHistory = (
  history: ModelMessage[],
  approvalResponses?: ToolApprovalResponse[]
): ModelMessage[] => {
  if (!approvalResponses || approvalResponses.length === 0) {
    return history;
  }

  return [
    ...history,
    {
      role: 'tool',
      content: structuredClone(approvalResponses),
    },
  ];
};

export const appendResponseMessages = (
  history: ModelMessage[],
  responseMessages: unknown
): ModelMessage[] => {
  const incrementalMessages = extractResponseMessages(responseMessages);
  if (incrementalMessages.length === 0) {
    return history;
  }

  return [...history, ...incrementalMessages];
};

const isToolCall = (
  value: unknown
): value is { toolName: string; input?: unknown; args?: unknown } =>
  typeof value === 'object' &&
  value !== null &&
  'toolName' in value &&
  typeof (value as { toolName: unknown }).toolName === 'string' &&
  ('input' in value || 'args' in value);

export const normalizeToolArgs = (input: unknown): Record<string, unknown> => {
  if (input === undefined) return {};
  if (typeof input === 'object' && input !== null && !Array.isArray(input)) {
    return input as Record<string, unknown>;
  }
  return { value: input };
};

const getToolCallInput = (toolCall: { input?: unknown; args?: unknown }): unknown =>
  toolCall.input !== undefined ? toolCall.input : toolCall.args;

const normalizeCollectedToolCall = (toolCall: {
  toolName: string;
  input?: unknown;
  args?: unknown;
}): { toolName: string; args: Record<string, unknown> } => {
  const acpDynamicTool = unwrapAcpDynamicToolCall({
    toolName: toolCall.toolName,
    input: getToolCallInput(toolCall),
  });

  return {
    toolName: acpDynamicTool?.toolName ?? toolCall.toolName,
    args: normalizeToolArgs(acpDynamicTool ? acpDynamicTool.args : getToolCallInput(toolCall)),
  };
};

export const collectToolCalls = (
  steps?: Array<{ toolCalls?: unknown[] }> | null,
  fallbackToolCalls?: unknown[] | null
): Array<{ toolName: string; args: Record<string, unknown> }> | undefined => {
  const toolCalls: Array<{ toolName: string; input?: unknown; args?: unknown }> = [];

  if (Array.isArray(steps)) {
    for (const step of steps) {
      if (Array.isArray(step.toolCalls)) {
        toolCalls.push(...step.toolCalls.filter(isToolCall));
      }
    }
  }

  if (toolCalls.length === 0 && Array.isArray(fallbackToolCalls)) {
    toolCalls.push(...fallbackToolCalls.filter(isToolCall));
  }

  if (toolCalls.length === 0) return undefined;

  return toolCalls.map(normalizeCollectedToolCall);
};

const isApprovalRequestPart = (
  value: unknown
): value is {
  type: 'tool-approval-request';
  approvalId: string;
  toolCall: { toolName: string; toolCallId?: string; input?: unknown; args?: unknown };
} =>
  typeof value === 'object' &&
  value !== null &&
  (value as { type?: unknown }).type === 'tool-approval-request' &&
  typeof (value as { approvalId?: unknown }).approvalId === 'string' &&
  typeof (value as { toolCall?: { toolName?: unknown } }).toolCall?.toolName === 'string';

export const collectApprovalRequests = (contentParts: unknown): ToolApprovalRequest[] => {
  if (!Array.isArray(contentParts)) return [];

  return contentParts.filter(isApprovalRequestPart).map(part => {
    const toolCall = normalizeCollectedToolCall(part.toolCall);
    return {
      approvalId: part.approvalId,
      toolCallId: part.toolCall.toolCallId,
      toolCall,
    };
  });
};

const isModelMessageLike = (value: unknown): value is ModelMessage =>
  typeof value === 'object' &&
  value !== null &&
  'role' in value &&
  typeof (value as { role: unknown }).role === 'string' &&
  'content' in value;

export const extractResponseMessages = (responseMessages: unknown): ModelMessage[] =>
  Array.isArray(responseMessages) ? responseMessages.filter(isModelMessageLike) : [];
