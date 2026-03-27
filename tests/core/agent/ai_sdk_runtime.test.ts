import { describe, expect, it, vi, beforeEach } from 'vitest';
import { z } from 'zod';

const { getFullSystemPromptMock, getAppConfigMock, loggerEventMock } = vi.hoisted(() => ({
  getFullSystemPromptMock: vi.fn(),
  getAppConfigMock: vi.fn(),
  loggerEventMock: vi.fn(),
}));

vi.mock('../../../src/core/provider/llm/factory', () => ({
  getFullSystemPrompt: getFullSystemPromptMock,
}));

vi.mock('../../../src/core/config', () => ({
  getAppConfig: getAppConfigMock,
}));

vi.mock('../../../src/core/logger', () => ({
  createLogger: vi.fn(() => ({
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    event: loggerEventMock,
    span: vi.fn(),
  })),
}));

import {
  appendApprovalResponsesToHistory,
  appendResponseMessages,
  appendUserPromptToHistory,
  buildAiToolSet,
  buildPromptContext,
  cloneModelMessages,
  collectApprovalRequests,
  getDefaultAgentConfig,
  loadAgentConfig,
} from '../../../src/core/agent/ai_sdk_runtime';

beforeEach(() => {
  vi.clearAllMocks();
  getFullSystemPromptMock.mockReturnValue('persona prompt');
});

describe('ai_sdk_runtime', () => {
  it('builds a combined system prompt and strips system messages from the message list', () => {
    const history = [
      { role: 'system' as const, content: 'thread system' },
      { role: 'user' as const, content: 'hello' },
    ];

    expect(
      buildPromptContext(
        {
          providerType: 'openai',
          systemPrompt: 'runtime system',
        },
        history
      )
    ).toEqual({
      systemPrompt: 'persona prompt\n\nruntime system\n\nthread system',
      messages: [{ role: 'user', content: 'hello' }],
    });
  });

  it('clones and appends prompt/approval/response messages without mutating the original history', () => {
    const originalHistory = [{ role: 'user' as const, content: 'hello' }];
    const clonedHistory = cloneModelMessages(originalHistory);
    const promptedHistory = appendUserPromptToHistory(clonedHistory, 'follow up');
    const approvedHistory = appendApprovalResponsesToHistory(promptedHistory, [
      {
        type: 'tool-approval-response',
        approvalId: 'approval_1',
        approved: true,
        reason: 'approved',
      },
    ]);
    const appendedHistory = appendResponseMessages(approvedHistory, [
      { role: 'assistant', content: [{ type: 'text', text: 'done' }] },
    ]);

    expect(originalHistory).toEqual([{ role: 'user', content: 'hello' }]);
    expect(appendedHistory).toEqual([
      { role: 'user', content: 'hello' },
      { role: 'user', content: 'follow up' },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-approval-response',
            approvalId: 'approval_1',
            approved: true,
            reason: 'approved',
          },
        ],
      },
      { role: 'assistant', content: [{ type: 'text', text: 'done' }] },
    ]);
  });

  it('collects tool approval requests and normalizes scalar args', () => {
    expect(
      collectApprovalRequests([
        {
          type: 'tool-approval-request',
          approvalId: 'approval_1',
          toolCall: {
            toolCallId: 'call_1',
            toolName: 'fetch',
            input: 'https://example.com',
          },
        },
      ])
    ).toEqual([
      {
        approvalId: 'approval_1',
        toolCallId: 'call_1',
        toolCall: {
          toolName: 'fetch',
          args: {
            value: 'https://example.com',
          },
        },
      },
    ]);
  });

  it('uses explicit runtime overrides without touching app config', () => {
    getAppConfigMock.mockImplementation(() => {
      throw new Error('app config should not be loaded');
    });

    expect(
      loadAgentConfig({
        enabled: true,
        providerType: 'openai',
        model: 'gpt-4o-mini',
        systemPrompt: 'runtime prompt',
        enableTools: false,
      })
    ).toEqual({
      ...getDefaultAgentConfig(),
      enabled: true,
      providerType: 'openai',
      model: 'gpt-4o-mini',
      systemPrompt: 'runtime prompt',
      enableTools: false,
    });

    expect(getAppConfigMock).not.toHaveBeenCalled();
    expect(loggerEventMock).not.toHaveBeenCalled();
  });

  it('loads app config only when no explicit runtime override is provided', () => {
    getAppConfigMock.mockReturnValue({
      agent: {
        enabled: true,
        providerType: 'deepseek',
        model: 'deepseek-chat',
        systemPrompt: 'stored prompt',
        temperature: 0.3,
        maxTokens: 512,
        maxIterations: 4,
        enableTools: true,
        enableMemory: true,
      },
    });

    expect(loadAgentConfig()).toEqual({
      enabled: true,
      providerType: 'deepseek',
      model: 'deepseek-chat',
      systemPrompt: 'stored prompt',
      temperature: 0.3,
      maxTokens: 512,
      maxIterations: 4,
      enableTools: true,
      enableMemory: true,
    });

    expect(getAppConfigMock).toHaveBeenCalledTimes(1);
    expect(loggerEventMock).not.toHaveBeenCalled();
  });

  it('falls back to defaults and logs when app config loading fails', () => {
    const error = new Error('db unavailable');
    getAppConfigMock.mockImplementation(() => {
      throw error;
    });

    expect(loadAgentConfig()).toEqual(getDefaultAgentConfig());
    expect(loggerEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'error',
        event: 'agent.config.load',
        outcome: 'failed',
        error,
      })
    );
  });

  it('builds executable AI SDK tools from both Zod and JSON schemas', async () => {
    const zodHandler = vi.fn(async (args: unknown) => ({ source: 'zod', args }));
    const jsonHandler = vi.fn(async (args: unknown) => ({ source: 'json', args }));

    const tools = buildAiToolSet({ enableTools: true }, [
      {
        name: 'lookup',
        type: 'function',
        description: 'Lookup tool',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string' },
          },
          required: ['query'],
        },
        paramSchema: z.object({
          query: z.string(),
        }),
        needsApproval: false,
        autoAllowed: true,
        displayName: 'Lookup',
        source: { kind: 'builtin' },
        handler: zodHandler,
      },
      {
        name: 'fetch_json',
        type: 'function',
        description: 'JSON tool',
        parameters: {
          type: 'object',
          properties: {
            url: { type: 'string' },
          },
          required: ['url'],
        },
        needsApproval: false,
        autoAllowed: true,
        displayName: 'Fetch Json',
        source: { kind: 'builtin' },
        handler: jsonHandler,
      },
    ]);

    expect(tools).toBeDefined();
    expect(Object.keys(tools ?? {})).toEqual(['lookup', 'fetch_json']);
    expect(await tools?.lookup.execute?.({ query: 'hello' }, {} as never)).toEqual({
      source: 'zod',
      args: { query: 'hello' },
    });
    expect(await tools?.fetch_json.execute?.({ url: 'https://example.com' }, {} as never)).toEqual({
      source: 'json',
      args: { url: 'https://example.com' },
    });
    expect(zodHandler).toHaveBeenCalledWith({ query: 'hello' });
    expect(jsonHandler).toHaveBeenCalledWith({ url: 'https://example.com' });
  });
});
