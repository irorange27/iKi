import { describe, expect, it, vi, beforeEach } from 'vitest';
import { z } from 'zod';

const { acpToolsMock, getFullSystemPromptMock, getAppConfigMock, loggerEventMock } = vi.hoisted(
  () => ({
    acpToolsMock: vi.fn((tools: Record<string, unknown>) => ({
      ...tools,
      'acp.acp_provider_agent_dynamic_tool': { type: 'provider' },
    })),
    getFullSystemPromptMock: vi.fn(),
    getAppConfigMock: vi.fn(),
    loggerEventMock: vi.fn(),
  })
);

vi.mock('@mcpc-tech/acp-ai-provider', () => ({
  acpTools: acpToolsMock,
}));

vi.mock('@iki/core/provider/llm/factory', () => ({
  getFullSystemPrompt: getFullSystemPromptMock,
}));

vi.mock('@iki/core/context/config_provider', () => ({
  getAppConfig: getAppConfigMock,
}));

vi.mock('@iki/core/logger', () => ({
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
  collectToolCalls,
  getDefaultAgentConfig,
  loadAgentConfig,
} from '@iki/core/agent/ai_sdk_runtime';

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
          providerId: '',
          systemPrompt: 'runtime system',
        },
        history
      )
    ).toEqual({
      systemPrompt: 'persona prompt\n\nruntime system\n\nthread system',
      messages: [{ role: 'user', content: 'hello' }],
    });
  });

  it('drops orphaned tool messages before sending prompt context to the provider', () => {
    const history = [
      { role: 'system' as const, content: 'thread system' },
      { role: 'user' as const, content: 'hello' },
      {
        role: 'tool' as const,
        content: [{ type: 'tool-result', toolCallId: 'orphan_1', output: { ok: true } }],
      },
      { role: 'user' as const, content: 'follow up' },
    ];

    expect(
      buildPromptContext(
        {
          providerType: 'openai',
          providerId: '',
          systemPrompt: 'runtime system',
        },
        history
      )
    ).toEqual({
      systemPrompt: 'persona prompt\n\nruntime system\n\nthread system',
      messages: [
        { role: 'user', content: 'hello' },
        { role: 'user', content: 'follow up' },
      ],
    });
    expect(loggerEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'warn',
        event: 'agent.history.tool_messages_sanitized',
        outcome: 'degraded',
        data: expect.objectContaining({
          dropped_message_count: 1,
          message_count_before: 3,
          message_count_after: 2,
        }),
      })
    );
  });

  it('preserves approval-response tool messages when the preceding assistant message anchors them', () => {
    const history = [
      {
        role: 'assistant' as const,
        content: [
          {
            type: 'tool-approval-request',
            approvalId: 'approval_1',
            toolCall: {
              toolCallId: 'call_1',
              toolName: 'web',
              input: { q: 'hello' },
            },
          },
        ],
      },
      {
        role: 'tool' as const,
        content: [
          {
            type: 'tool-approval-response',
            approvalId: 'approval_1',
            approved: true,
            reason: 'approved',
          },
        ],
      },
    ];

    expect(
      buildPromptContext(
        {
          providerType: 'openai',
          providerId: '',
          systemPrompt: '',
        },
        history
      ).messages
    ).toEqual(history);
    expect(loggerEventMock).not.toHaveBeenCalled();
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

  it('unwraps ACP dynamic approval requests into the host tool name and args', () => {
    expect(
      collectApprovalRequests([
        {
          type: 'tool-approval-request',
          approvalId: 'approval_2',
          toolCall: {
            toolCallId: 'call_2',
            toolName: 'acp.acp_provider_agent_dynamic_tool',
            input: JSON.stringify({
              toolCallId: 'call_2',
              toolName: 'write_file',
              args: {
                path: 'notes.md',
              },
            }),
          },
        },
      ])
    ).toEqual([
      {
        approvalId: 'approval_2',
        toolCallId: 'call_2',
        toolCall: {
          toolName: 'write_file',
          args: {
            path: 'notes.md',
          },
        },
      },
    ]);
  });

  it('collects tool calls from args when input is absent', () => {
    expect(
      collectToolCalls(undefined, [
        {
          toolName: 'lookup',
          args: {
            query: 'hello',
          },
        },
      ])
    ).toEqual([
      {
        toolName: 'lookup',
        args: {
          query: 'hello',
        },
      },
    ]);
  });

  it('unwraps ACP dynamic tool calls into the actual host tool payload', () => {
    expect(
      collectToolCalls(
        [
          {
            toolCalls: [
              {
                toolName: 'acp.acp_provider_agent_dynamic_tool',
                input: JSON.stringify({
                  toolName: 'write_file',
                  args: {
                    path: 'notes.md',
                    text: 'hello',
                  },
                }),
              },
            ],
          },
        ],
        undefined
      )
    ).toEqual([
      {
        toolName: 'write_file',
        args: {
          path: 'notes.md',
          text: 'hello',
        },
      },
    ]);
  });

  it('merges runtime overrides on top of the app config base without losing pre-configured settings', () => {
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

    expect(
      loadAgentConfig({
        enabled: true,
        providerType: 'openai',
        model: 'gpt-4o-mini',
        systemPrompt: 'runtime prompt',
        enableTools: false,
      })
    ).toEqual({
      enabled: true,
      providerType: 'openai',
      providerId: '',
      model: 'gpt-4o-mini',
      systemPrompt: 'runtime prompt',
      temperature: 0.3,
      maxTokens: 512,
      maxIterations: 4,
      enableTools: false,
      enableMemory: true,
    });

    expect(getAppConfigMock).toHaveBeenCalled();
  });

  it('falls back to defaults when app config fails and override is provided', () => {
    const error = new Error('db unavailable');
    getAppConfigMock.mockImplementation(() => {
      throw error;
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
      providerId: '',
      model: 'gpt-4o-mini',
      systemPrompt: 'runtime prompt',
      enableTools: false,
    });
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
      providerId: '',
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

    const tools = buildAiToolSet({ enableTools: true, providerType: 'openai' }, [
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

  it('wraps ACP tool-capable runtimes with the ACP dynamic tool even when no local tools are registered', () => {
    const tools = buildAiToolSet({ enableTools: true, providerType: 'acp' }, []);

    expect(acpToolsMock).toHaveBeenCalledWith({});
    expect(tools).toEqual({
      'acp.acp_provider_agent_dynamic_tool': { type: 'provider' },
    });
  });
});
