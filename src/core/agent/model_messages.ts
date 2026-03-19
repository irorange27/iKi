import type { ModelMessage } from 'ai';

import type { AgentMessage } from './types';

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

export const extractTextFromModelMessageContent = (content: unknown): string => {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';

  return content
    .filter(
      part =>
        isObjectRecord(part) &&
        part.type === 'text' &&
        typeof part.text === 'string' &&
        part.text.length > 0
    )
    .map(part => String((part as { text: string }).text))
    .join('');
};

export const convertModelMessagesToAgentMessages = (messages: ModelMessage[]): AgentMessage[] => {
  const agentMessages: AgentMessage[] = [];

  for (const message of messages) {
    const timestamp = new Date().toISOString();

    if (message.role === 'system' || message.role === 'user') {
      agentMessages.push({
        role: message.role,
        content: extractTextFromModelMessageContent(message.content),
        timestamp,
      });
      continue;
    }

    if (message.role === 'assistant') {
      const textContent = extractTextFromModelMessageContent(message.content);
      const metadata: Record<string, unknown> = {};

      if (Array.isArray(message.content)) {
        const assistantParts = message.content as unknown[];
        const toolCalls = assistantParts.filter(
          part => isObjectRecord(part) && part.type === 'tool-call'
        );
        const toolApprovalRequests = assistantParts.filter(
          part => isObjectRecord(part) && part.type === 'tool-approval-request'
        );

        if (toolCalls.length > 0) {
          metadata.toolCalls = toolCalls;
        }
        if (toolApprovalRequests.length > 0) {
          metadata.toolApprovalRequests = toolApprovalRequests;
        }
      }

      if (!textContent && Object.keys(metadata).length === 0) {
        continue;
      }

      agentMessages.push({
        role: 'assistant',
        content: textContent,
        timestamp,
        ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
      });
      continue;
    }

    if (message.role !== 'tool') {
      continue;
    }

    if (!Array.isArray(message.content)) {
      agentMessages.push({
        role: 'tool',
        content:
          typeof message.content === 'string'
            ? message.content
            : JSON.stringify(message.content ?? {}),
        timestamp,
      });
      continue;
    }

    const toolParts = message.content as unknown[];
    for (const part of toolParts) {
      if (!isObjectRecord(part) || typeof part.type !== 'string') continue;
      const partType = part.type;

      if (partType === 'tool-result') {
        const resultPart = part as {
          output?: unknown;
          toolCallId?: unknown;
          toolName?: unknown;
        };
        agentMessages.push({
          role: 'tool',
          content: JSON.stringify(resultPart.output ?? {}),
          timestamp,
          metadata: {
            toolCallId: resultPart.toolCallId,
            toolName: resultPart.toolName,
          },
        });
        continue;
      }

      if (partType !== 'tool-approval-response') {
        continue;
      }

      const approvalPart = part as {
        approvalId?: unknown;
        approved?: unknown;
        reason?: unknown;
      };
      agentMessages.push({
        role: 'tool',
        content: JSON.stringify({
          approvalId: approvalPart.approvalId,
          approved: approvalPart.approved,
          reason: approvalPart.reason,
        }),
        timestamp,
        metadata: {
          approvalId: approvalPart.approvalId,
        },
      });
    }
  }

  return agentMessages;
};
