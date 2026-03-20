import { jsonSchema, tool, type ModelMessage, type ToolApprovalResponse, type ToolSet } from 'ai';

import { getAppConfig } from '../config';
import { logger } from '../logger';
import { getFullSystemPrompt } from '../provider/llm/factory';
import { extractTextFromModelMessageContent } from './model_messages';
import {
  AgentConfigSchema,
  type AgentConfig,
  type AgentTool,
  type PartialAgentConfig,
  type ToolApprovalRequest,
} from './types';

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

export const loadAgentConfig = (overrideConfig?: PartialAgentConfig): AgentConfig => {
  try {
    const appConfig = getAppConfig();
    const agentConfig = appConfig?.agent || getDefaultAgentConfig();
    return AgentConfigSchema.parse({
      ...agentConfig,
      ...overrideConfig,
    });
  } catch (error) {
    logger.error('Failed to load agent config:', error);
    try {
      return AgentConfigSchema.parse({
        ...getDefaultAgentConfig(),
        ...overrideConfig,
      });
    } catch (parseError) {
      logger.error('Failed to parse agent config:', parseError);
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
    logger.debug('buildTools: tools disabled or no tools registered');
    return undefined;
  }

  const tools: ToolSet = {};
  logger.debug(`buildTools: building tools for ${registeredTools.length} registered tools`);

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
        logger.debug(`Tool ${agentTool.name} built successfully with Zod schema`, {
          toolName: agentTool.name,
          hasExecute: typeof toolDefWithExecute.execute === 'function',
        });

        tools[agentTool.name] = toolDef;
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        const stack = error instanceof Error ? error.stack : undefined;
        logger.error(`Failed to build tool ${agentTool.name} with Zod schema`, {
          error: message,
          stack,
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
        logger.debug(`Tool ${agentTool.name} built successfully with JSON Schema`, {
          toolName: agentTool.name,
          hasExecute: typeof toolDefWithExecute.execute === 'function',
        });

        tools[agentTool.name] = toolDef;
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        const stack = error instanceof Error ? error.stack : undefined;
        logger.error(`Failed to build tool ${agentTool.name} with JSON Schema`, {
          error: message,
          stack,
          parameters: JSON.stringify(agentTool.parameters, null, 2),
        });
        throw error;
      }
      continue;
    }

    logger.warn(`Tool ${agentTool.name} has neither parameters nor paramSchema`);
  }

  logger.debug(`buildTools: built ${Object.keys(tools).length} tools`, {
    toolNames: Object.keys(tools),
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
