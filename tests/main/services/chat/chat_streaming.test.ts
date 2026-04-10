import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_CHAT_TOOL_MAX_ITERATIONS,
  NO_TOOLS_SYSTEM_PROMPT,
  TOOL_AGENT_SYSTEM_PROMPT,
} from '../../../../src/main/services/chat/chat_constants';

const {
  dbPrepareMock,
  dbGetMock,
  dbAllMock,
  dbRunMock,
  getAppConfigMock,
  shouldGuardToolsMock,
  generateChatWithUsageMock,
  resolveModelCapabilityMock,
  assembleContextMock,
  createChatConversationRunnerMock,
  persistThreadRuntimeHintsMock,
  resolveToolNamesMock,
  createUiChunkEmitterMock,
  getPromptFromMessageMock,
  toLlmChatMessagesMock,
  toModelInputMessagesMock,
  createToolLoopRunnerMock,
  toolLoopStreamMock,
  defaultToolRegistryGetMock,
  createAgentRunTrackerMock,
  getErrorMessageMock,
  getMinimaxModelsMock,
} = vi.hoisted(() => ({
  dbPrepareMock: vi.fn(),
  dbGetMock: vi.fn(),
  dbAllMock: vi.fn(),
  dbRunMock: vi.fn(),
  getAppConfigMock: vi.fn(() => ({
    memory: {
      enabled: false,
      autoSummarize: false,
      context: {
        enabled: true,
      },
      emotion: {
        enabled: false,
        injectToSystemPrompt: false,
        realtimeAnalysis: false,
      },
    },
    mcp: {
      defaultApprovalMode: 'safe-only',
    },
  })),
  shouldGuardToolsMock: vi.fn(() => false),
  generateChatWithUsageMock: vi.fn(),
  resolveModelCapabilityMock: vi.fn(async () => null),
  assembleContextMock: vi.fn(),
  createChatConversationRunnerMock: vi.fn(),
  persistThreadRuntimeHintsMock: vi.fn(),
  resolveToolNamesMock: vi.fn(),
  createUiChunkEmitterMock: vi.fn(),
  getPromptFromMessageMock: vi.fn(),
  toLlmChatMessagesMock: vi.fn(),
  toModelInputMessagesMock: vi.fn(),
  createToolLoopRunnerMock: vi.fn(),
  toolLoopStreamMock: vi.fn(),
  defaultToolRegistryGetMock: vi.fn(),
  createAgentRunTrackerMock: vi.fn(),
  getErrorMessageMock: vi.fn((error: unknown) =>
    error instanceof Error ? error.message : String(error)
  ),
  getMinimaxModelsMock: vi.fn(async () => []),
}));

vi.mock('../../../../src/core/config', () => ({
  getAppConfig: getAppConfigMock,
}));

vi.mock('../../../../src/core/db/database', () => ({
  getDb: vi.fn(() => ({
    prepare: dbPrepareMock,
    transaction: vi.fn((fn: (...args: unknown[]) => unknown) => fn),
  })),
}));

vi.mock('../../../../src/core/db/affect_state', () => ({
  getAffectState: vi.fn(() => null),
}));

vi.mock('../../../../src/core/db/chat_thread', () => ({
  getChatThread: vi.fn(() => null),
}));

vi.mock('../../../../src/core/db/emotion', () => ({
  listEmotionEvents: vi.fn(() => []),
}));

vi.mock('../../../../src/core/db/memory', () => ({
  listShortMemory: vi.fn(() => []),
}));

vi.mock('../../../../src/core/emotion/affect_state', () => ({
  buildAffectSystemMessage: vi.fn(() => ''),
  collectEmotionSamples: vi.fn(() => []),
  computeAffectState: vi.fn(() => null),
  rehydrateAffectState: vi.fn(() => null),
}));

vi.mock('../../../../src/core/emotion/affect_policy', () => ({
  shouldGuardTools: shouldGuardToolsMock,
}));

vi.mock('../../../../src/core/provider/emotion_model', () => ({
  analyzeEmotionWithAgent: vi.fn(() => null),
}));

vi.mock('../../../../src/core/provider/llm/factory', () => ({
  generateChatWithUsage: generateChatWithUsageMock,
  fetchModelsFromDev: vi.fn(async () => []),
  resolveModelCapability: resolveModelCapabilityMock,
  getProviderConfig: vi.fn(() => ({ apiKey: 'test-key' })),
}));

vi.mock('../../../../src/core/provider/llm/deepseek', () => ({
  getDeepSeekModels: vi.fn(async () => []),
}));

vi.mock('../../../../src/core/provider/llm/openai', () => ({
  getOpenAIModels: vi.fn(async () => []),
}));

vi.mock('../../../../src/core/provider/llm/kimi', () => ({
  getKimiModels: vi.fn(async () => []),
}));

vi.mock('../../../../src/core/provider/llm/minimax', () => ({
  getMinimaxModels: getMinimaxModelsMock,
}));

vi.mock('../../../../src/core/tools', () => ({
  defaultToolRegistry: {
    get: defaultToolRegistryGetMock,
  },
}));

vi.mock('../../../../src/main/utils/errors', () => ({
  getErrorMessage: getErrorMessageMock,
}));

vi.mock('../../../../src/main/services/chat/chat_context', () => ({
  createChatContextAssembler: vi.fn(() => ({
    assemble: assembleContextMock,
  })),
}));

vi.mock('../../../../src/main/services/chat/chat_conversation_runner', () => ({
  createChatConversationRunner: createChatConversationRunnerMock,
}));

vi.mock('../../../../src/main/services/chat/chat_thread_hints', () => ({
  persistThreadRuntimeHints: persistThreadRuntimeHintsMock,
}));

vi.mock('../../../../src/main/services/chat/chat_tools', () => ({
  resolveToolNames: resolveToolNamesMock,
}));

vi.mock('../../../../src/main/services/chat/chat_ui', () => ({
  createUiChunkEmitter: createUiChunkEmitterMock,
  getPromptFromMessage: getPromptFromMessageMock,
  toLlmChatMessages: toLlmChatMessagesMock,
  toModelInputMessages: toModelInputMessagesMock,
}));

vi.mock('../../../../src/main/services/chat/chat_tool_loop', () => ({
  createToolLoopRunner: createToolLoopRunnerMock,
}));

vi.mock('../../../../src/main/services/chat/chat_run_tracking', () => ({
  createAgentRunTracker: createAgentRunTrackerMock,
}));

import { createChatStreaming } from '../../../../src/main/services/chat/chat_streaming';

const createDeps = () => {
  const activeStreams = new Map();
  const ensurePendingApprovalSession = vi.fn();
  const registerApprovalBatch = vi.fn();
  const recordUsageEvent = vi.fn();
  const memory = {
    injectMemoryIntoMessages: vi.fn((messages: unknown[]) => messages),
    getAffectState: vi.fn(() => null),
    getAffectContextMessage: vi.fn(() => ''),
    buildRealtimeAffectContext: vi.fn(async () => ({ message: '', state: null })),
    preloadRealtimeEmotion: vi.fn(),
    recordRealtimeEmotion: vi.fn(),
    retrieveRelevantMemory: vi.fn(() => null),
    waitForEmotionAnalysis: vi.fn(async () => undefined),
  };

  return {
    activeStreams,
    ensurePendingApprovalSession,
    registerApprovalBatch,
    recordUsageEvent,
    memory,
    streaming: createChatStreaming({
      activeStreams,
      memory,
      usage: { recordUsageEvent },
      approvals: {
        ensurePendingApprovalSession,
        registerApprovalBatch,
      },
    }),
  };
};

beforeEach(() => {
  vi.clearAllMocks();
  dbPrepareMock.mockReturnValue({
    get: dbGetMock,
    all: dbAllMock,
    run: dbRunMock,
  });
  dbGetMock.mockReturnValue(null);
  dbAllMock.mockReturnValue([]);
  dbRunMock.mockReturnValue({});

  assembleContextMock.mockImplementation(async (params: { messages: unknown[] }) => ({
    messages: params.messages,
    usedSkills: [],
    skillMode: 'manual',
    report: {
      totalEstimatedTokens: 0,
      retainedRecentMessages: Array.isArray(params.messages) ? params.messages.length : 0,
      compactedMessages: 0,
      blocks: [],
    },
    effectiveContextConfig: {
      maxOutputTokens: null,
    },
  }));
  resolveToolNamesMock.mockResolvedValue({
    mode: 'manual',
    explicitTools: [],
    resolvedTools: [],
  });
  toModelInputMessagesMock.mockImplementation(async (messages: unknown[]) => messages);
  getPromptFromMessageMock.mockImplementation((message: { content?: unknown }) =>
    typeof message?.content === 'string' ? message.content : ''
  );
  toLlmChatMessagesMock.mockReturnValue([{ role: 'user', content: 'hello' }]);
  generateChatWithUsageMock.mockResolvedValue({
    text: 'assistant result',
    usage: {
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
    },
  });

  const defaultRunner = {
    registerTool: vi.fn(),
    generate: vi.fn().mockResolvedValue({ response: 'tool result', iterations: 1 }),
  };
  createChatConversationRunnerMock.mockReturnValue(defaultRunner);

  defaultToolRegistryGetMock.mockReturnValue({
    name: 'web',
    description: 'Search',
    parameters: {},
    handler: vi.fn(async () => ({ ok: true })),
  });

  toolLoopStreamMock.mockResolvedValue({ awaitingApproval: false });
  createToolLoopRunnerMock.mockReturnValue({
    stream: toolLoopStreamMock,
  });

  createUiChunkEmitterMock.mockReturnValue({
    messageId: 'assistant_1',
    emitTextDelta: vi.fn(),
    emitToolEvent: vi.fn(),
    emitSkillUsage: vi.fn(),
    emitMemoryRetrieval: vi.fn(),
    emitAffectSignal: vi.fn(),
    emitTokenUsage: vi.fn(),
    finish: vi.fn(),
    abort: vi.fn(),
    error: vi.fn(),
  });

  createAgentRunTrackerMock.mockImplementation(() => {
    let status = 'running';
    return {
      id: 'run_1',
      getRun: () => ({ status }),
      syncModelMessages: vi.fn(() => ({ status })),
      recordToolEvent: vi.fn(),
      markCompleted: vi.fn(() => {
        status = 'completed';
        return { status };
      }),
      markBlocked: vi.fn(() => {
        status = 'blocked';
        return { status };
      }),
      markFailed: vi.fn(() => {
        status = 'failed';
        return { status };
      }),
      markCancelled: vi.fn(() => {
        status = 'cancelled';
        return { status };
      }),
    };
  });
});

describe('createChatStreaming', () => {
  it('getModels() routes MiniMax through the provider-specific cache path', async () => {
    getMinimaxModelsMock.mockResolvedValueOnce(['MiniMax-M2']);

    const { streaming } = createDeps();

    await expect(streaming.getModels('minimax')).resolves.toEqual([
      {
        id: 'MiniMax-M2',
        displayName: 'MiniMax-M2',
        contextWindow: null,
        maxInputTokens: null,
        maxOutputTokens: null,
      },
    ]);
    expect(getMinimaxModelsMock).toHaveBeenCalledTimes(1);
  });

  it('stream() emits skill usage citations and reports real token usage before rendering the response', async () => {
    assembleContextMock.mockResolvedValue({
      messages: [{ role: 'user', content: 'hello' }],
      skillMode: 'auto',
      usedSkills: [
        {
          id: 'codex:.system/openai-docs',
          name: 'openai-docs',
          description: 'Official docs guidance',
          source: 'codex',
        },
      ],
      report: {
        totalEstimatedTokens: 120,
        retainedRecentMessages: 1,
        compactedMessages: 0,
        blocks: [{ kind: 'skills', status: 'included', estimatedTokens: 120, charCount: 480 }],
      },
      effectiveContextConfig: {
        maxOutputTokens: 700,
      },
    });
    resolveModelCapabilityMock.mockResolvedValueOnce({
      maxInputTokens: 128000,
      contextWindow: 128000,
    });
    toolLoopStreamMock.mockResolvedValueOnce({
      awaitingApproval: false,
      usage: {
        inputTokens: 912,
        outputTokens: 48,
        totalTokens: 960,
      },
    });

    const { streaming } = createDeps();
    const webContents = { id: 11, send: vi.fn() };

    const result = await streaming.stream(webContents, {
      providerType: 'openai',
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'hello' }],
      threadId: 'thread_skills',
      skillMode: 'auto',
    });

    expect(result).toEqual({
      success: true,
      awaitingApproval: false,
      stopped: false,
    });
    expect(createUiChunkEmitterMock.mock.results[0]?.value.emitSkillUsage).toHaveBeenCalledWith({
      mode: 'auto',
      skills: [
        {
          id: 'codex:.system/openai-docs',
          name: 'openai-docs',
          description: 'Official docs guidance',
          source: 'codex',
        },
      ],
    });
    expect(toolLoopStreamMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tokenUsageContext: {
          maxInputTokens: 128000,
          maxOutputTokens: 700,
          model: 'gpt-4o-mini',
          providerType: 'openai',
        },
      })
    );
    const runner = createChatConversationRunnerMock.mock.results[0]?.value;
    expect(runner?.registerTool).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'load_skill',
      })
    );
  });

  it('stream() prefers the renderer-provided model capability snapshot for token usage context', async () => {
    assembleContextMock.mockResolvedValue({
      messages: [{ role: 'user', content: 'hello' }],
      usedSkills: [],
      skillMode: 'manual',
      report: {
        totalEstimatedTokens: 0,
        retainedRecentMessages: 1,
        compactedMessages: 0,
        blocks: [],
      },
      effectiveContextConfig: {
        maxOutputTokens: 700,
      },
    });
    resolveModelCapabilityMock.mockResolvedValueOnce(null);

    const { streaming } = createDeps();
    const webContents = { id: 11, send: vi.fn() };

    await streaming.stream(webContents, {
      providerType: 'openai',
      providerId: 'provider_openai',
      model: 'gpt-4o-mini',
      modelCapability: {
        contextWindow: 200000,
        maxInputTokens: 200000,
        maxOutputTokens: 5000,
      },
      messages: [{ role: 'user', content: 'hello' }],
      threadId: 'thread_snapshot',
    });

    expect(toolLoopStreamMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tokenUsageContext: {
          maxInputTokens: 200000,
          maxOutputTokens: 5000,
          model: 'gpt-4o-mini',
          providerType: 'openai',
          providerId: 'provider_openai',
        },
      })
    );
  });

  it('send() uses plain llm generation when no tools are enabled', async () => {
    assembleContextMock.mockResolvedValue({
      messages: [{ role: 'user', content: 'hello' }],
      usedSkills: [],
      skillMode: 'manual',
      report: {
        totalEstimatedTokens: 0,
        retainedRecentMessages: 1,
        compactedMessages: 0,
        blocks: [],
      },
      effectiveContextConfig: {
        maxOutputTokens: 700,
      },
    });

    const { streaming } = createDeps();

    const result = await streaming.send({
      providerType: 'openai',
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'hello' }],
      threadId: 'thread_1',
    });

    expect(result).toEqual({ success: true, text: 'assistant result' });
    expect(createAgentRunTrackerMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'chat-turn',
        systemPrompt: NO_TOOLS_SYSTEM_PROMPT,
        input: expect.objectContaining({
          metadata: expect.objectContaining({
            transport: 'send',
            contextTokens: 0,
            enableTools: false,
          }),
        }),
      })
    );
    expect(createAgentRunTrackerMock.mock.results[0]?.value.markCompleted).toHaveBeenCalledWith(
      expect.objectContaining({
        text: 'assistant result',
        finishReason: 'completed',
      })
    );
    expect(generateChatWithUsageMock).toHaveBeenCalledTimes(1);
    expect(generateChatWithUsageMock).toHaveBeenCalledWith({
      providerType: 'openai',
      modelId: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'hello' }],
      extraSystemPrompt: NO_TOOLS_SYSTEM_PROMPT,
      maxOutputTokens: 700,
    });
    expect(createChatConversationRunnerMock).not.toHaveBeenCalled();
    expect(assembleContextMock).toHaveBeenCalledTimes(1);
    expect(assembleContextMock).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [{ role: 'user', content: 'hello' }],
        threadId: 'thread_1',
        includeMemory: false,
      })
    );
    expect(persistThreadRuntimeHintsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: 'thread_1',
        tools: [],
      })
    );
  });

  it('send() routes through the runner when selected skills need on-demand loading', async () => {
    assembleContextMock.mockResolvedValue({
      messages: [{ role: 'user', content: 'draft it' }],
      usedSkills: [
        {
          id: 'user:planner',
          name: 'Planner',
          description: 'Planning support',
          source: 'user',
        },
      ],
      skillMode: 'auto',
      report: {
        totalEstimatedTokens: 32,
        retainedRecentMessages: 1,
        compactedMessages: 0,
        blocks: [{ kind: 'skills', status: 'included', estimatedTokens: 32, charCount: 128 }],
      },
    });

    const runner = {
      registerTool: vi.fn(),
      generate: vi.fn().mockResolvedValue({ response: 'skill aware result', iterations: 1 }),
    };
    createChatConversationRunnerMock.mockReturnValue(runner);

    const { streaming } = createDeps();
    const result = await streaming.send({
      providerType: 'openai',
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'draft it' }],
      threadId: 'thread_skill_tool',
      skillMode: 'auto',
    });

    expect(result).toEqual({ success: true, text: 'skill aware result' });
    expect(createChatConversationRunnerMock).toHaveBeenCalledTimes(1);
    expect(runner.registerTool).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'load_skill',
      })
    );
    expect(generateChatWithUsageMock).not.toHaveBeenCalled();
  });

  it('send() merges declarative required built-in tools from selected skills into the same turn', async () => {
    assembleContextMock.mockResolvedValue({
      messages: [{ role: 'user', content: 'check local playback state' }],
      usedSkills: [
        {
          id: 'user:music',
          name: 'Music',
          description: 'Playback support',
          source: 'user',
          requiredTools: ['shell'],
        },
      ],
      skillMode: 'auto',
      report: {
        totalEstimatedTokens: 40,
        retainedRecentMessages: 1,
        compactedMessages: 0,
        blocks: [{ kind: 'skills', status: 'included', estimatedTokens: 40, charCount: 160 }],
      },
    });
    defaultToolRegistryGetMock.mockImplementation((toolName?: string) =>
      toolName === 'shell'
        ? {
            name: 'shell',
            description: 'Run shell commands',
            parameters: {},
            source: { kind: 'builtin' },
            handler: vi.fn(async () => ({ ok: true })),
          }
        : undefined
    );

    const runner = {
      registerTool: vi.fn(),
      generate: vi.fn().mockResolvedValue({ response: 'shell skill result', iterations: 1 }),
    };
    createChatConversationRunnerMock.mockReturnValue(runner);

    const { streaming } = createDeps();
    const result = await streaming.send({
      providerType: 'openai',
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'check local playback state' }],
      threadId: 'thread_skill_required_tool',
      skillMode: 'auto',
    });

    expect(result).toEqual({ success: true, text: 'shell skill result' });
    expect(createChatConversationRunnerMock).toHaveBeenCalledWith(
      expect.objectContaining({
        enabledTools: ['shell'],
      })
    );
    expect(runner.registerTool).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'load_skill',
      })
    );
    expect(runner.registerTool).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'shell',
      })
    );
    expect(generateChatWithUsageMock).not.toHaveBeenCalled();
  });

  it('send() routes through the tool runner when tools are enabled', async () => {
    resolveToolNamesMock.mockResolvedValue({
      mode: 'manual',
      explicitTools: ['web'],
      resolvedTools: ['web'],
    });
    toModelInputMessagesMock.mockResolvedValue([
      { role: 'system', content: 'history' },
      { role: 'user', content: 'use tool' },
    ]);

    const runner = {
      registerTool: vi.fn(),
      generate: vi.fn().mockResolvedValue({ response: 'tool path result', iterations: 1 }),
    };
    createChatConversationRunnerMock.mockReturnValue(runner);

    const { streaming, recordUsageEvent } = createDeps();
    const result = await streaming.send({
      providerType: 'openai',
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'use tool' }],
      tools: ['web'],
      threadId: 'thread_2',
    });

    expect(result).toEqual({ success: true, text: 'tool path result' });
    expect(createChatConversationRunnerMock).toHaveBeenCalledTimes(1);
    expect(runner.registerTool).toHaveBeenCalledTimes(1);
    expect(assembleContextMock).toHaveBeenCalledTimes(1);
    expect(runner.generate).toHaveBeenCalledWith({
      history: [{ role: 'system', content: 'history' }],
      prompt: 'use tool',
    });
    expect(generateChatWithUsageMock).not.toHaveBeenCalled();
    expect(recordUsageEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'chat.send.tools',
      })
    );
  });

  it('send() fails clearly when a non-interactive tool turn requires approval', async () => {
    resolveToolNamesMock.mockResolvedValue({
      mode: 'manual',
      explicitTools: ['shell'],
      resolvedTools: ['shell'],
    });
    toModelInputMessagesMock.mockResolvedValue([
      { role: 'system', content: 'history' },
      { role: 'user', content: 'check bbc' },
    ]);

    const runner = {
      registerTool: vi.fn(),
      generate: vi.fn().mockResolvedValue({
        response: '让我尝试访问BBC新闻：',
        iterations: 1,
        toolApprovalRequests: [
          {
            approvalId: 'approval_shell_1',
            toolCall: {
              toolName: 'shell',
              args: { command: 'curl https://www.bbc.com/news' },
            },
          },
        ],
      }),
    };
    createChatConversationRunnerMock.mockReturnValue(runner);

    defaultToolRegistryGetMock.mockReturnValue({
      name: 'shell',
      description: 'Run shell commands',
      parameters: {},
      handler: vi.fn(async () => ({ ok: true })),
    });

    const { streaming, recordUsageEvent } = createDeps();
    const result = await streaming.send({
      providerType: 'openai',
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'check bbc' }],
      tools: ['shell'],
      threadId: 'thread_approval_blocked',
    });

    expect(result).toEqual({
      success: false,
      error: 'Tool approval required for non-interactive chat: shell',
    });
    expect(createAgentRunTrackerMock.mock.results[0]?.value.markBlocked).toHaveBeenCalledWith(
      expect.objectContaining({
        text: '让我尝试访问BBC新闻：',
        pendingApprovalIds: ['approval_shell_1'],
      })
    );
    expect(recordUsageEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'chat.send.tools',
        metadata: expect.objectContaining({
          approvalRequestCount: 1,
        }),
      })
    );
  });

  it('registers approval-gated tools without approval prompts when global auto-approve is enabled', async () => {
    getAppConfigMock.mockReturnValue({
      general: {
        autoApproveToolRequests: true,
      },
      memory: {
        enabled: false,
        autoSummarize: false,
        context: {
          enabled: true,
        },
        emotion: {
          enabled: false,
          injectToSystemPrompt: false,
          realtimeAnalysis: false,
        },
      },
      mcp: {
        defaultApprovalMode: 'safe-only',
      },
    });

    resolveToolNamesMock.mockResolvedValue({
      mode: 'manual',
      explicitTools: ['shell'],
      resolvedTools: ['shell'],
    });
    toModelInputMessagesMock.mockResolvedValue([{ role: 'user', content: 'run ls' }]);

    const runner = {
      registerTool: vi.fn(),
      generate: vi.fn().mockResolvedValue({ response: 'done', iterations: 1 }),
    };
    createChatConversationRunnerMock.mockReturnValue(runner);

    defaultToolRegistryGetMock.mockReturnValue({
      name: 'shell',
      description: 'Run shell commands',
      needsApproval: true,
      parameters: {},
      handler: vi.fn(async () => ({ ok: true })),
    });

    const { streaming } = createDeps();
    const result = await streaming.send({
      providerType: 'openai',
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'run ls' }],
      tools: ['shell'],
      threadId: 'thread_auto_approve',
    });

    expect(result).toEqual({ success: true, text: 'done' });
    expect(runner.registerTool).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'shell',
        needsApproval: false,
      })
    );
  });

  it('preserves explicit approval requirements for locked-approval tools even when auto-approve is enabled', async () => {
    getAppConfigMock.mockReturnValue({
      general: {
        autoApproveToolRequests: true,
      },
      memory: {
        enabled: false,
        autoSummarize: false,
        context: {
          enabled: true,
        },
        emotion: {
          enabled: false,
          injectToSystemPrompt: false,
          realtimeAnalysis: false,
        },
      },
      mcp: {
        defaultApprovalMode: 'safe-only',
      },
    });

    resolveToolNamesMock.mockResolvedValue({
      mode: 'manual',
      explicitTools: ['write_personal_skill'],
      resolvedTools: ['write_personal_skill'],
    });
    toModelInputMessagesMock.mockResolvedValue([{ role: 'user', content: 'update skill' }]);

    const runner = {
      registerTool: vi.fn(),
      generate: vi.fn().mockResolvedValue({
        response: '',
        iterations: 1,
        toolApprovalRequests: [
          {
            approvalId: 'approval_skill_1',
            toolCall: { toolName: 'write_personal_skill', args: { id: 'user:planner' } },
          },
        ],
      }),
    };
    createChatConversationRunnerMock.mockReturnValue(runner);

    defaultToolRegistryGetMock.mockReturnValue({
      name: 'write_personal_skill',
      description: 'Update a personal skill',
      needsApproval: true,
      approvalMode: 'always',
      parameters: {},
      handler: vi.fn(async () => ({ ok: true })),
    });

    const { streaming } = createDeps();
    const result = await streaming.send({
      providerType: 'openai',
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'update skill' }],
      tools: ['write_personal_skill'],
      threadId: 'thread_locked_approve',
    });

    expect(result).toEqual({
      success: false,
      error: 'Tool approval required for non-interactive chat: write_personal_skill',
    });
    expect(runner.registerTool).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'write_personal_skill',
        needsApproval: true,
        approvalMode: 'always',
      })
    );
  });

  it('stream() persists pending approval sessions when tool events request approval', async () => {
    assembleContextMock.mockResolvedValue({
      messages: [
        { role: 'system', content: 'history' },
        { role: 'user', content: 'stream tool' },
      ],
      usedSkills: [],
      skillMode: 'manual',
      report: {
        totalEstimatedTokens: 24,
        retainedRecentMessages: 2,
        compactedMessages: 0,
        blocks: [],
      },
      effectiveContextConfig: {
        maxOutputTokens: 512,
      },
    });
    resolveToolNamesMock.mockResolvedValue({
      mode: 'manual',
      explicitTools: ['web'],
      resolvedTools: ['web'],
    });
    toModelInputMessagesMock.mockResolvedValue([
      { role: 'system', content: 'history' },
      { role: 'user', content: 'stream tool' },
    ]);

    const runner = {
      registerTool: vi.fn(),
    };
    createChatConversationRunnerMock.mockReturnValue(runner);

    const uiChunkEmitter = {
      messageId: 'assistant_stream',
      emitTextDelta: vi.fn(),
      emitToolEvent: vi.fn(),
      emitSkillUsage: vi.fn(),
      emitMemoryRetrieval: vi.fn(),
      emitAffectSignal: vi.fn(),
      emitTokenUsage: vi.fn(),
      finish: vi.fn(),
      abort: vi.fn(),
      error: vi.fn(),
    };
    createUiChunkEmitterMock.mockReturnValue(uiChunkEmitter);

    toolLoopStreamMock.mockImplementation(
      async (params: { onToolEvent?: (event: unknown) => void }) => {
        params.onToolEvent?.({
          type: 'tool-approval-request',
          approvalId: 'approval_1',
          toolCall: {
            toolName: 'web',
            args: { query: 'hello' },
          },
        });
        return { awaitingApproval: true };
      }
    );

    const { streaming, activeStreams, ensurePendingApprovalSession } = createDeps();
    const webContents = { id: 7, send: vi.fn() };
    const result = await streaming.stream(webContents, {
      providerType: 'openai',
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'stream tool' }],
      tools: ['web'],
      threadId: 'thread_3',
    });

    expect(result).toEqual({
      success: true,
      awaitingApproval: true,
      stopped: false,
    });
    expect(createAgentRunTrackerMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'chat-turn',
        systemPrompt: TOOL_AGENT_SYSTEM_PROMPT,
        input: expect.objectContaining({
          metadata: expect.objectContaining({
            transport: 'stream',
            assistantMessageId: 'assistant_stream',
          }),
        }),
      })
    );
    expect(
      createAgentRunTrackerMock.mock.results[0]?.value.recordToolEvent
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'tool-approval-request',
        approvalId: 'approval_1',
      })
    );
    expect(createAgentRunTrackerMock.mock.results[0]?.value.markBlocked).toHaveBeenCalled();
    expect(ensurePendingApprovalSession).toHaveBeenCalledWith(
      'approval_1',
      expect.objectContaining({
        harness: expect.objectContaining({
          getRegisteredTools: expect.any(Function),
          stream: expect.any(Function),
        }),
        webContents,
        recoveryContext: expect.objectContaining({
          threadId: 'thread_3',
          runId: 'run_1',
          maxOutputTokens: 512,
          maxIterations: DEFAULT_CHAT_TOOL_MAX_ITERATIONS,
          enabledTools: ['web'],
          availableSkillIds: [],
        }),
      })
    );
    expect(createChatConversationRunnerMock).toHaveBeenCalledWith(
      expect.objectContaining({
        providerType: 'openai',
        model: 'gpt-4o-mini',
        enableTools: true,
        maxIterations: DEFAULT_CHAT_TOOL_MAX_ITERATIONS,
        maxTokens: 512,
      })
    );
    expect(toolLoopStreamMock).toHaveBeenCalledWith(
      expect.objectContaining({
        harness: expect.objectContaining({
          getRegisteredTools: expect.any(Function),
          stream: expect.any(Function),
        }),
        history: [{ role: 'system', content: 'history' }],
        prompt: 'stream tool',
      })
    );
    expect(uiChunkEmitter.emitToolEvent).toHaveBeenCalledTimes(1);
    expect(activeStreams.size).toBe(0);
  });

  it('stream() returns final tool-loop text even when it arrives only at completion', async () => {
    assembleContextMock.mockResolvedValue({
      messages: [
        { role: 'system', content: 'history' },
        { role: 'user', content: 'stream tool' },
      ],
      usedSkills: [],
      skillMode: 'manual',
      report: {
        totalEstimatedTokens: 24,
        retainedRecentMessages: 2,
        compactedMessages: 0,
        blocks: [],
      },
      effectiveContextConfig: {
        maxOutputTokens: 512,
      },
    });
    resolveToolNamesMock.mockResolvedValue({
      mode: 'manual',
      explicitTools: ['web'],
      resolvedTools: ['web'],
    });
    toModelInputMessagesMock.mockResolvedValue([
      { role: 'system', content: 'history' },
      { role: 'user', content: 'stream tool' },
    ]);
    toolLoopStreamMock.mockResolvedValue({
      awaitingApproval: false,
      response: 'Explanation: done\nExact Answer: 42\nConfidence: 90%',
    });

    const { streaming } = createDeps();
    const webContents = { id: 13, send: vi.fn() };
    const result = await streaming.stream(webContents, {
      providerType: 'openai',
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'stream tool' }],
      tools: ['web'],
      threadId: 'thread_tool_text',
    });

    expect(result).toEqual({
      success: true,
      awaitingApproval: false,
      text: 'Explanation: done\nExact Answer: 42\nConfidence: 90%',
      stopped: false,
    });
  });

  it('stream() forwards an explicit tool-iteration cap for daemon-style callers', async () => {
    assembleContextMock.mockResolvedValue({
      messages: [
        { role: 'system', content: 'history' },
        { role: 'user', content: 'stream tool' },
      ],
      usedSkills: [],
      skillMode: 'manual',
      report: {
        totalEstimatedTokens: 24,
        retainedRecentMessages: 2,
        compactedMessages: 0,
        blocks: [],
      },
      effectiveContextConfig: {
        maxOutputTokens: 512,
      },
    });
    resolveToolNamesMock.mockResolvedValue({
      mode: 'manual',
      explicitTools: ['web'],
      resolvedTools: ['web'],
    });
    toModelInputMessagesMock.mockResolvedValue([
      { role: 'system', content: 'history' },
      { role: 'user', content: 'stream tool' },
    ]);

    const { streaming } = createDeps();
    const webContents = { id: 14, send: vi.fn() };
    await streaming.stream(webContents, {
      providerType: 'openai',
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'stream tool' }],
      tools: ['web'],
      threadId: 'thread_tool_iterations',
      maxIterations: 12,
    });

    expect(createChatConversationRunnerMock).toHaveBeenCalledWith(
      expect.objectContaining({
        providerType: 'openai',
        model: 'gpt-4o-mini',
        enableTools: true,
        maxIterations: 12,
        maxTokens: 512,
      })
    );
  });

  it('treats affect as a first-class turn signal for routing and ui emission', async () => {
    getAppConfigMock.mockReturnValue({
      memory: {
        enabled: false,
        autoSummarize: false,
        context: {
          enabled: true,
        },
        emotion: {
          enabled: true,
          injectToSystemPrompt: true,
          realtimeAnalysis: false,
          toolGuard: {
            enabled: true,
            minConfidence: 0.6,
            minArousal: 0.6,
            maxValence: -0.2,
            requireApproval: true,
            disableAutoTools: false,
          },
        },
      },
      mcp: {
        defaultApprovalMode: 'safe-only',
      },
    });

    resolveToolNamesMock.mockResolvedValue({
      mode: 'auto',
      explicitTools: [],
      resolvedTools: ['web'],
    });

    const affectState = {
      label: 'anger',
      confidence: 0.82,
      valence: -0.64,
      arousal: 0.77,
      emotions: [{ label: 'anger', score: 0.82 }],
      sampleCount: 3,
      windowSize: 8,
      startAt: '2026-03-22T00:00:00.000Z',
      endAt: '2026-03-22T00:05:00.000Z',
      ageMinutes: 1,
      windowMinutes: 5,
    };

    const { streaming, memory } = createDeps();
    memory.getAffectState.mockReturnValue(affectState);
    const webContents = { id: 12, send: vi.fn() };

    const result = await streaming.stream(webContents, {
      providerType: 'openai',
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'handle this carefully' }],
      threadId: 'thread_affect',
    });

    expect(result).toEqual({
      success: true,
      awaitingApproval: false,
      stopped: false,
    });
    expect(resolveToolNamesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        affectState,
      })
    );
    expect(persistThreadRuntimeHintsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        affectSignal: {
          source: 'history',
          guardActive: false,
          state: affectState,
        },
      })
    );
    expect(createUiChunkEmitterMock.mock.results[0]?.value.emitAffectSignal).toHaveBeenCalledWith({
      source: 'history',
      guardActive: false,
      state: affectState,
    });
  });

  it('preloads realtime affect asynchronously instead of blocking the current turn', async () => {
    getAppConfigMock.mockReturnValue({
      memory: {
        enabled: false,
        autoSummarize: false,
        context: {
          enabled: true,
        },
        emotion: {
          enabled: true,
          injectToSystemPrompt: true,
          realtimeAnalysis: true,
        },
      },
      mcp: {
        defaultApprovalMode: 'safe-only',
      },
    });

    const { streaming, memory } = createDeps();

    const result = await streaming.send({
      providerType: 'openai',
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'read this carefully' }],
      threadId: 'thread_realtime_affect',
    });

    expect(result).toEqual({ success: true, text: 'assistant result' });
    expect(memory.preloadRealtimeEmotion).toHaveBeenCalledWith(
      'thread_realtime_affect',
      'read this carefully'
    );
    expect(resolveToolNamesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        affectState: null,
      })
    );
    expect(memory.recordRealtimeEmotion).not.toHaveBeenCalled();
  });

  it('injects an explicit intervention policy for experiment runs and persists the signal', async () => {
    const affectState = {
      label: 'sadness',
      confidence: 0.88,
      valence: -0.72,
      arousal: 0.74,
      emotions: [{ label: 'sadness', score: 0.88 }],
      sampleCount: 3,
      windowSize: 6,
      startAt: '2026-04-01T00:00:00.000Z',
      endAt: '2026-04-01T00:03:00.000Z',
      ageMinutes: 1,
      windowMinutes: 3,
    };
    toLlmChatMessagesMock.mockImplementation(messages => messages as never);

    const { streaming, memory } = createDeps();
    memory.getAffectState.mockReturnValue(affectState);

    const result = await streaming.send({
      providerType: 'openai',
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'user',
          content: '直接帮我写回复吧，但我现在整个人都很焦虑，也很怕把事情弄得更糟。',
        },
      ],
      threadId: 'thread_policy',
      experimentalContext: {
        affectMode: 'explicit_policy',
        contextMode: 'benchmark_clean',
      },
    });

    expect(result).toEqual({ success: true, text: 'assistant result' });
    expect(resolveToolNamesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        affectState: null,
      })
    );
    expect(persistThreadRuntimeHintsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        affectSignal: expect.objectContaining({
          source: 'history',
          state: affectState,
        }),
        interventionPolicy: expect.objectContaining({
          interventionState: 'co_plan',
          affectUsed: true,
          applied: true,
        }),
      })
    );
    expect(toLlmChatMessagesMock).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'system',
          content: expect.stringContaining('Turn intervention policy:'),
        }),
      ])
    );
  });

  it('records but does not apply an explicit policy during tone_only runs', async () => {
    toLlmChatMessagesMock.mockImplementation(messages => messages as never);

    const { streaming, memory } = createDeps();
    memory.getAffectState.mockReturnValue({
      label: 'sadness',
      confidence: 0.77,
      valence: -0.61,
      arousal: 0.68,
      emotions: [{ label: 'sadness', score: 0.77 }],
      sampleCount: 2,
      windowSize: 4,
      startAt: '2026-04-01T00:00:00.000Z',
      endAt: '2026-04-01T00:02:00.000Z',
      ageMinutes: 1,
      windowMinutes: 2,
    });

    await streaming.send({
      providerType: 'openai',
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: '我有点卡住了，但还是想继续推进。' }],
      threadId: 'thread_tone_only',
      experimentalContext: {
        affectMode: 'tone_only',
        contextMode: 'benchmark_clean',
      },
    });

    expect(assembleContextMock).toHaveBeenCalledWith(
      expect.objectContaining({
        affectContextMode: 'default',
      })
    );
    expect(persistThreadRuntimeHintsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        affectSignal: expect.anything(),
        interventionPolicy: expect.objectContaining({
          applied: false,
          affectUsed: false,
        }),
      })
    );
    expect(toLlmChatMessagesMock).not.toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'system',
          content: expect.stringContaining('Turn intervention policy:'),
        }),
      ])
    );
  });

  it('fully disables affect context and keeps policy audit-only during no_affect runs', async () => {
    toLlmChatMessagesMock.mockImplementation(messages => messages as never);

    const { streaming, memory } = createDeps();
    memory.getAffectState.mockReturnValue({
      label: 'anger',
      confidence: 0.8,
      valence: -0.58,
      arousal: 0.71,
      emotions: [{ label: 'anger', score: 0.8 }],
      sampleCount: 2,
      windowSize: 4,
      startAt: '2026-04-01T00:00:00.000Z',
      endAt: '2026-04-01T00:01:00.000Z',
      ageMinutes: 1,
      windowMinutes: 1,
    });

    await streaming.send({
      providerType: 'openai',
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: '先别替我写，我要自己想一想。' }],
      threadId: 'thread_no_affect',
      experimentalContext: {
        affectMode: 'no_affect',
        contextMode: 'benchmark_clean',
      },
    });

    expect(assembleContextMock).toHaveBeenCalledWith(
      expect.objectContaining({
        affectContextMode: 'disabled',
        realtimeAffectMessage: '',
      })
    );
    expect(persistThreadRuntimeHintsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        affectSignal: null,
        interventionPolicy: expect.objectContaining({
          applied: false,
          affectUsed: false,
        }),
      })
    );
    expect(toLlmChatMessagesMock).not.toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'system',
          content: expect.stringContaining('Turn intervention policy:'),
        }),
      ])
    );
  });

  it('awaits realtime affect context when the experiment requests same-turn affect injection', async () => {
    const affectState = {
      label: 'anger',
      confidence: 0.74,
      valence: -0.55,
      arousal: 0.81,
      emotions: [{ label: 'anger', score: 0.74 }],
      sampleCount: 1,
      windowSize: 1,
      startAt: '2026-04-01T00:00:00.000Z',
      endAt: '2026-04-01T00:00:00.000Z',
      ageMinutes: 0,
      windowMinutes: 0,
    };
    const { streaming, memory } = createDeps();
    memory.buildRealtimeAffectContext.mockResolvedValue({
      message: 'Realtime affect context.',
      state: affectState,
    });

    await streaming.send({
      providerType: 'openai',
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'read this carefully' }],
      threadId: 'thread_realtime_injected',
      experimentalContext: {
        affectMode: 'tone_only',
        awaitRealtimeAffect: true,
      },
    });

    expect(memory.buildRealtimeAffectContext).toHaveBeenCalledWith(
      'thread_realtime_injected',
      'read this carefully',
      { force: true }
    );
    expect(memory.preloadRealtimeEmotion).not.toHaveBeenCalled();
    expect(assembleContextMock).toHaveBeenCalledWith(
      expect.objectContaining({
        realtimeAffectMessage: 'Realtime affect context.',
      })
    );
  });
});
