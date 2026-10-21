import { describe, expect, it } from 'vitest';

import {
  parseChatMessageCreatePayload,
  parseChatSendPayload,
  parseChatThreadCreatePayload,
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
        'tools:run',
        'tools:approve',
        'mcp:read',
        'mcp:write',
      ],
      allowedTools: getDefaultAllowedTools(),
    });
  });

  it('accepts a workspace binding on thread create and rejects a non-string value', () => {
    // A headless client must be able to bind a thread to its workspace at
    // create time (dogfood §A step 4) instead of reaching into SQLite.
    expect(
      parseChatThreadCreatePayload({ title: 'Dogfood', workspace_id: ' ws-dogfood ' })
    ).toEqual({ title: 'Dogfood', workspace_id: 'ws-dogfood' });

    // Omitted and explicit-null both mean "no binding", and the omitted case
    // must not invent the key — the desktop path keeps the payload it sent.
    expect(parseChatThreadCreatePayload({ title: 'Chat' })).toEqual({ title: 'Chat' });
    expect(parseChatThreadCreatePayload({ workspace_id: null })).toEqual({
      workspace_id: null,
    });

    // A wrong type used to be dropped silently, yielding an unbound thread
    // whose file/shell tools then refuse to run with no explanation.
    expect(() => parseChatThreadCreatePayload({ workspace_id: 123 })).toThrow();
    expect(() => parseChatThreadCreatePayload({ workspace_id: '   ' })).toThrow();
  });

  it('accepts a workspace binding on thread create and rejects a non-string value', () => {
    // A headless client must be able to bind a thread to its workspace at
    // create time (dogfood §A step 4) instead of reaching into SQLite.
    expect(
      parseChatThreadCreatePayload({ title: 'Dogfood', workspace_id: ' ws-dogfood ' })
    ).toEqual({ title: 'Dogfood', workspace_id: 'ws-dogfood' });

    // Omitted and explicit-null both mean "no binding", and the omitted case
    // must not invent the key — the desktop path keeps the payload it sent.
    expect(parseChatThreadCreatePayload({ title: 'Chat' })).toEqual({ title: 'Chat' });
    expect(parseChatThreadCreatePayload({ workspace_id: null })).toEqual({
      workspace_id: null,
    });

    // A wrong type used to be dropped silently, yielding an unbound thread
    // whose file/shell tools then refuse to run with no explanation.
    expect(() => parseChatThreadCreatePayload({ workspace_id: 123 })).toThrow();
    expect(() => parseChatThreadCreatePayload({ workspace_id: '   ' })).toThrow();
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
          context_mode: 'benchmark_clean',
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
        contextMode: 'benchmark_clean',
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
