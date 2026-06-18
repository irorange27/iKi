import { describe, expect, it } from 'vitest';

import {
  parseChatMessageCreatePayload,
  parseChatSendPayload,
  parseClientRegistrationPayload,
  parseDaemonWebSocketMessage,
  parseMcpServerCreatePayload,
  parseMcpServerUpdatePayload,
} from '@iki/daemon/server_schemas';
import { getDefaultAllowedTools } from '@iki/daemon/tool_access';

describe('daemon server schemas', () => {
  it('normalizes client registration defaults and trims explicit values', () => {
    expect(
      parseClientRegistrationPayload({
        name: '  Desktop Client  ',
        scopes: [' chat:read ', 'chat:write'],
        allowed_tools: [' web ', 'mcp:server:docs'],
      })
    ).toEqual({
      name: 'Desktop Client',
      scopes: ['chat:read', 'chat:write'],
      allowedTools: ['web', 'mcp:server:docs'],
    });

    expect(parseClientRegistrationPayload({})).toEqual({
      name: 'iKi Client',
      scopes: [
        'chat:read',
        'chat:write',
        'memory:read',
        'memory:write',
        'tools:run',
        'tools:approve',
        'mcp:read',
        'mcp:write',
      ],
      allowedTools: getDefaultAllowedTools(),
    });
  });

  it('requires providerType and model for chat send payloads', () => {
    expect(
      parseChatSendPayload({
        providerType: 'openai',
        model: 'gpt-4.1',
        messages: [{ role: 'user', content: 'hi' }],
        thread_id: 'thread_1',
        skillIds: ['skill_1'],
        skillMode: 'manual',
        experimental_context: {
          affect_mode: 'explicit_policy',
          context_mode: 'benchmark_clean',
          await_realtime_affect: true,
        },
      })
    ).toEqual({
      providerType: 'openai',
      model: 'gpt-4.1',
      messages: [{ role: 'user', content: 'hi' }],
      threadId: 'thread_1',
      tools: undefined,
      mcpServerIds: undefined,
      skillIds: ['skill_1'],
      skillMode: 'manual',
      experimentalContext: {
        affectMode: 'explicit_policy',
        contextMode: 'benchmark_clean',
        awaitRealtimeAffect: true,
      },
    });

    expect(() =>
      parseChatSendPayload({
        providerType: 'openai',
        model: '',
      })
    ).toThrow();
  });

  it('parses benchmark message replay payloads', () => {
    expect(
      parseChatMessageCreatePayload({
        thread_id: 'thread_1',
        role: 'user',
        content: 'hello',
        await_emotion_analysis: true,
      })
    ).toEqual({
      threadId: 'thread_1',
      role: 'user',
      content: 'hello',
      timestamp: undefined,
      metadata: undefined,
      awaitEmotionAnalysis: true,
    });
  });

  it('validates MCP create and update payload shapes', () => {
    expect(() =>
      parseMcpServerCreatePayload({
        name: 'Local Tools',
        transport: 'stdio',
      })
    ).toThrow(/command is required for stdio servers/i);

    expect(() =>
      parseMcpServerCreatePayload({
        name: 'Remote Docs',
        transport: 'streamable-http',
      })
    ).toThrow(/base_url is required for remote servers/i);

    expect(
      parseMcpServerUpdatePayload({
        enabled: false,
        tool_allowlist: ['web'],
      })
    ).toEqual({
      enabled: false,
      tool_allowlist: ['web'],
    });

    expect(() => parseMcpServerUpdatePayload({})).toThrow(/payload must include/i);
  });

  it('parses websocket messages and rejects invalid approval payloads', () => {
    expect(
      parseDaemonWebSocketMessage({
        type: 'start',
        request_id: 'req_1',
        payload: {
          providerType: 'openai',
          model: 'gpt-4.1',
          messages: [],
        },
      })
    ).toEqual({
      type: 'start',
      request_id: 'req_1',
      payload: {
        providerType: 'openai',
        model: 'gpt-4.1',
        messages: [],
        threadId: undefined,
        tools: undefined,
        mcpServerIds: undefined,
        skillIds: undefined,
        skillMode: undefined,
        experimentalContext: undefined,
      },
    });

    expect(() =>
      parseDaemonWebSocketMessage({
        type: 'approve-tool',
        approval_id: 'approval_1',
        approved: 'yes',
      })
    ).toThrow();
  });
});
