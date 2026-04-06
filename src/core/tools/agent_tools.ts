import { z } from 'zod';

import type { AgentResult, AgentTool } from '../agent/types';
import { createSimpleConversationRunner } from '../agent/runners/simple_conversation_runner';
import { getToolModel } from '../provider/tool_model';
import { BaseTool, defaultToolRegistry } from './base';
import { zodSchemaToJsonSchema } from './json_schema';
import {
  AgentToolInputSchema,
  AgentToolOutputSchema,
  DEFAULT_AGENT_MAX_ITERATIONS,
} from './schemas';
import {
  getToolRuntimeContext,
  runWithToolRuntimeContext,
  type ToolRuntimeConversationModel,
} from './runtime_context';

const AGENT_TOOL_NAME = 'agent';
const DEFAULT_AGENT_MAX_TOKENS = 2000;
const MAX_TOOL_NAMES_IN_ERROR = 10;

const SUBAGENT_SYSTEM_PROMPT =
  'You are a delegated subagent working for the parent iKi agent.\n' +
  'Rules:\n' +
  '- Solve only the delegated subtask, not the whole user request.\n' +
  '- You may use only the tools exposed to you for this delegated run.\n' +
  '- Do not ask for, rely on, or attempt approval-gated/destructive tools here.\n' +
  '- Do not delegate again; recursive agent spawning is disabled.\n' +
  '- Keep reasoning private and return a concise, high-signal result for the parent agent.\n' +
  '- If you cannot complete the delegated subtask with the provided context and tools, say exactly what is missing.\n';

const normalizeToolNames = (input: unknown): string[] => {
  if (!Array.isArray(input)) return [];

  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const entry of input) {
    if (typeof entry !== 'string') continue;
    const trimmed = entry.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    normalized.push(trimmed);
  }
  return normalized;
};

const isApprovalFreeTool = (tool: Pick<AgentTool, 'needsApproval' | 'approvalMode'>): boolean =>
  tool.approvalMode !== 'always' &&
  (tool.needsApproval === false || tool.needsApproval === undefined);

const formatToolNameList = (toolNames: string[]): string =>
  toolNames.slice(0, MAX_TOOL_NAMES_IN_ERROR).join(', ');

const buildDelegationPrompt = (
  args: z.infer<typeof AgentToolInputSchema>,
  toolNames: string[]
): string => {
  const sections = [
    '<delegated_subtask>',
    args.task.trim(),
    '</delegated_subtask>',
  ];

  const context = args.context?.trim();
  if (context) {
    sections.push('<delegated_context>');
    sections.push(context);
    sections.push('</delegated_context>');
  }

  const expectedOutput = args.expectedOutput?.trim();
  if (expectedOutput) {
    sections.push('<expected_output>');
    sections.push(expectedOutput);
    sections.push('</expected_output>');
  }

  sections.push(
    `<delegation_contract tools="${toolNames.join(', ')}" max_iterations="${args.maxIterations ?? DEFAULT_AGENT_MAX_ITERATIONS}">Return only the subtask result for the parent agent. Be concrete and complete.</delegation_contract>`
  );

  return sections.join('\n');
};

const resolveConversationModel = (): ToolRuntimeConversationModel => {
  const runtimeModel = getToolRuntimeContext().conversationModel;
  if (
    runtimeModel &&
    typeof runtimeModel.providerType === 'string' &&
    runtimeModel.providerType.trim() &&
    typeof runtimeModel.model === 'string' &&
    runtimeModel.model.trim()
  ) {
    return runtimeModel;
  }

  const toolModel = getToolModel();
  if (!toolModel) {
    throw new Error('Delegated agent model is unavailable for this turn.');
  }

  return {
    providerType: toolModel.providerType,
    model: toolModel.model,
  };
};

const resolveRuntimeTools = (): AgentTool[] => {
  const runtimeTools = getToolRuntimeContext().availableTools;
  if (Array.isArray(runtimeTools) && runtimeTools.length > 0) {
    return runtimeTools;
  }
  return defaultToolRegistry.getAll();
};

const resolveDelegableTools = (requestedTools: string[] | undefined): AgentTool[] => {
  const toolMap = new Map<string, AgentTool>();
  for (const tool of resolveRuntimeTools()) {
    if (!tool || typeof tool.name !== 'string' || !tool.name.trim()) continue;
    toolMap.set(tool.name, tool);
  }

  if (requestedTools !== undefined) {
    const resolved: AgentTool[] = [];
    const normalizedRequested = normalizeToolNames(requestedTools);

    for (const toolName of normalizedRequested) {
      if (toolName === AGENT_TOOL_NAME) {
        throw new Error('Recursive delegated agent calls are disabled.');
      }

      const tool = toolMap.get(toolName);
      if (!tool) {
        const availableTools = Array.from(toolMap.keys()).sort((left, right) =>
          left.localeCompare(right)
        );
        throw new Error(
          `Tool "${toolName}" is not enabled for this delegated run. Available tools: ${formatToolNameList(availableTools)}`
        );
      }

      if (!isApprovalFreeTool(tool)) {
        throw new Error(
          `Tool "${toolName}" requires approval and cannot be used inside the delegated agent tool.`
        );
      }

      resolved.push(tool);
    }

    return resolved;
  }

  return Array.from(toolMap.values()).filter(
    tool => tool.name !== AGENT_TOOL_NAME && isApprovalFreeTool(tool)
  );
};

const summarizeUsedTools = (
  toolCalls: AgentResult['toolCalls']
): Array<{ name: string; callCount: number }> => {
  const counts = new Map<string, number>();
  for (const toolCall of toolCalls ?? []) {
    const toolName =
      typeof toolCall?.toolName === 'string' ? toolCall.toolName.trim() : '';
    if (!toolName) continue;
    counts.set(toolName, (counts.get(toolName) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .sort((left, right) => {
      const countDiff = right[1] - left[1];
      if (countDiff !== 0) return countDiff;
      return left[0].localeCompare(right[0]);
    })
    .map(([name, callCount]) => ({ name, callCount }));
};

export class DelegatedAgentTool extends BaseTool {
  override name = AGENT_TOOL_NAME;
  override displayName = 'Agent';
  override type = 'function';
  override autoAllowed = true;
  override needsApproval = false;
  override description =
    'Delegate a bounded subtask to a fresh subagent scratchpad. The delegated run inherits only the current turn\'s approval-free tools and cannot recursively spawn more agents.';
  override paramSchema = AgentToolInputSchema;
  override outputSchema = zodSchemaToJsonSchema(AgentToolOutputSchema, {
    title: 'agent_output',
  });

  protected override async handler(args: z.infer<typeof this.paramSchema>) {
    const runtimeContext = getToolRuntimeContext();
    const delegationDepth = Math.max(0, Math.trunc(runtimeContext.delegationDepth ?? 0));
    if (delegationDepth >= 1) {
      throw new Error('Recursive delegated agent calls are disabled.');
    }

    const conversationModel = resolveConversationModel();
    const delegatedTools = resolveDelegableTools(args.tools);
    const delegatedToolNames = delegatedTools.map(tool => tool.name);

    const runner = createSimpleConversationRunner({
      enabled: true,
      providerType: conversationModel.providerType,
      ...(typeof conversationModel.providerId === 'string' && conversationModel.providerId.trim()
        ? { providerId: conversationModel.providerId.trim() }
        : {}),
      model: conversationModel.model,
      systemPrompt: SUBAGENT_SYSTEM_PROMPT,
      maxTokens:
        typeof conversationModel.maxTokens === 'number' &&
        Number.isFinite(conversationModel.maxTokens) &&
        conversationModel.maxTokens > 0
          ? Math.trunc(conversationModel.maxTokens)
          : DEFAULT_AGENT_MAX_TOKENS,
      maxIterations: Math.max(
        1,
        Math.trunc(args.maxIterations || DEFAULT_AGENT_MAX_ITERATIONS)
      ),
      enableTools: delegatedTools.length > 0,
      enableMemory: false,
    });

    for (const tool of delegatedTools) {
      runner.registerTool(tool);
    }

    const result = await runWithToolRuntimeContext(
      {
        ...runtimeContext,
        availableTools: delegatedTools,
        conversationModel,
        delegationDepth: delegationDepth + 1,
      },
      async () =>
        await runner.generate({
          prompt: buildDelegationPrompt(args, delegatedToolNames),
        })
    );

    if ((result.toolApprovalRequests?.length ?? 0) > 0) {
      const toolNames = Array.from(
        new Set(
          (result.toolApprovalRequests ?? [])
            .map(request => request.toolCall?.toolName)
            .filter(
              (toolName): toolName is string =>
                typeof toolName === 'string' && toolName.trim().length > 0
            )
        )
      );
      throw new Error(
        `Delegated subagent requested approval-gated tools (${formatToolNameList(toolNames)}), which are not supported inside the agent tool. Run that step directly from the parent agent instead.`
      );
    }

    return {
      response: result.response,
      iterations: result.iterations,
      toolCallCount: result.toolCalls?.length ?? 0,
      usedTools: summarizeUsedTools(result.toolCalls),
      model: {
        providerType: conversationModel.providerType,
        ...(typeof conversationModel.providerId === 'string' && conversationModel.providerId.trim()
          ? { providerId: conversationModel.providerId.trim() }
          : {}),
        model: conversationModel.model,
      },
    };
  }
}
