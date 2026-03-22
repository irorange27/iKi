import { jsonSchema, tool, type ModelMessage, type ToolApprovalResponse, type ToolSet } from 'ai';

import { getAppConfig } from '../config';
import { createLogger } from '../logger';
import { getFullSystemPrompt } from '../provider/llm/factory';
import { extractTextFromModelMessageContent } from './model_messages';
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
    model: '',
    temperature: 0.1,
    maxTokens: 2000,
    maxIterations: 10,
    enableTools: false,
    enableMemory: false,
  });

const getAgentConfigBase = (overrideConfig?: PartialAgentConfig): PartialAgentConfig => {
  if (overrideConfig) {
    return getDefaultAgentConfig();
  }

  try {
    const appConfig = getAppConfig();
    return appConfig?.agent || getDefaultAgentConfig();
  } catch (error) {
    agentRuntimeLogger.event({
      level: 'error',
      event: 'agent.config.load',
      outcome: 'failed',
      error,
    });
    return getDefaultAgentConfig();
  }
};

export const loadAgentConfig = (overrideConfig?: PartialAgentConfig): AgentConfig => {
  const baseConfig = getAgentConfigBase(overrideConfig);

  try {
    return AgentConfigSchema.parse({
      ...baseConfig,
      ...overrideConfig,
    });
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
        ...overrideConfig,
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
  config: Pick<AgentConfig, 'enableTools'>,
  registeredTools: AgentTool[]
): ToolSet | undefined => {
  if (!config.enableTools || registeredTools.length === 0) {
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
    if (agentTool.paramSchema) {
      try {
        const toolDef = tool({
          description: agentTool.description,
          inputSchema: agentTool.paramSchema,
          ...(agentTool.outputSchema
            ? { outputSchema: jsonSchema(agentTool.outputSchema as object) }
            : {}),
          needsApproval: agentTool.needsApproval,
          execute: agentTool.handler,
        } as unknown as Parameters<typeof tool>[0]);

        const toolDefWithExecute = toolDef as unknown as { execute?: unknown };
        agentRuntimeLogger.event({
          level: 'debug',
          event: 'agent.tool.prepare',
          outcome: 'succeeded',
          data: {
            tool_name: agentTool.name,
            schema_source: 'zod',
            has_execute: typeof toolDefWithExecute.execute === 'function',
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
            schema_source: 'zod',
          },
        });
        throw error;
      }
      continue;
    }

    if (agentTool.parameters) {
      try {
        const toolDef = tool({
          description: agentTool.description,
          inputSchema: jsonSchema(agentTool.parameters as object),
          ...(agentTool.outputSchema
            ? { outputSchema: jsonSchema(agentTool.outputSchema as object) }
            : {}),
          needsApproval: agentTool.needsApproval,
          execute: agentTool.handler,
        } as unknown as Parameters<typeof tool>[0]);

        const toolDefWithExecute = toolDef as unknown as { execute?: unknown };
        agentRuntimeLogger.event({
          level: 'debug',
          event: 'agent.tool.prepare',
          outcome: 'succeeded',
          data: {
            tool_name: agentTool.name,
            schema_source: 'json',
            has_execute: typeof toolDefWithExecute.execute === 'function',
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
            schema_source: 'json',
            parameters: agentTool.parameters,
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
    },
  });

  return Object.keys(tools).length > 0 ? tools : undefined;
};

export const buildPromptContext = (
  config: Pick<AgentConfig, 'providerType' | 'systemPrompt'>,
  history: ModelMessage[]
): { systemPrompt: string; messages: ModelMessage[] } => {
  const systemParts: string[] = [getFullSystemPrompt(config.providerType)];

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

  return {
    systemPrompt: systemParts.join('\n\n'),
    messages: history.filter(message => message.role !== 'system'),
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

  return toolCalls.map(toolCall => ({
    toolName: toolCall.toolName,
    args: normalizeToolArgs(toolCall.input),
  }));
};

const isApprovalRequestPart = (
  value: unknown
): value is {
  type: 'tool-approval-request';
  approvalId: string;
  toolCall: { toolName: string; toolCallId?: string; input?: unknown };
} =>
  typeof value === 'object' &&
  value !== null &&
  (value as { type?: unknown }).type === 'tool-approval-request' &&
  typeof (value as { approvalId?: unknown }).approvalId === 'string' &&
  typeof (value as { toolCall?: { toolName?: unknown } }).toolCall?.toolName === 'string';

export const collectApprovalRequests = (contentParts: unknown): ToolApprovalRequest[] => {
  if (!Array.isArray(contentParts)) return [];

  return contentParts.filter(isApprovalRequestPart).map(part => ({
    approvalId: part.approvalId,
    toolCallId: part.toolCall.toolCallId,
    toolCall: {
      toolName: part.toolCall.toolName,
      args: normalizeToolArgs(part.toolCall.input),
    },
  }));
};

const isModelMessageLike = (value: unknown): value is ModelMessage =>
  typeof value === 'object' &&
  value !== null &&
  'role' in value &&
  typeof (value as { role: unknown }).role === 'string' &&
  'content' in value;

export const extractResponseMessages = (responseMessages: unknown): ModelMessage[] =>
  Array.isArray(responseMessages) ? responseMessages.filter(isModelMessageLike) : [];
