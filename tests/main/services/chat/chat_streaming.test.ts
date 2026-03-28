import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NO_TOOLS_SYSTEM_PROMPT } from '../../../../src/main/services/chat/chat_constants';

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
  getErrorMessageMock,
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
  getErrorMessageMock: vi.fn((error: unknown) =>
    error instanceof Error ? error.message : String(error)
  ),
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
    recordRealtimeEmotion: vi.fn(),
    retrieveRelevantMemory: vi.fn(() => null),
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
    emitContextReport: vi.fn(),
    finish: vi.fn(),
    abort: vi.fn(),
    error: vi.fn(),
  });
});

describe('createChatStreaming', () => {
  it('stream() emits skill usage citations before rendering the response', async () => {
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
    expect(createUiChunkEmitterMock.mock.results[0]?.value.emitContextReport).toHaveBeenCalledWith({
      totalEstimatedTokens: 120,
      retainedRecentMessages: 1,
      compactedMessages: 0,
      blocks: [{ kind: 'skills', status: 'included', estimatedTokens: 120, charCount: 480 }],
    });
    const runner = createChatConversationRunnerMock.mock.results[0]?.value;
    expect(runner?.registerTool).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'load_skill',
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
      emitContextReport: vi.fn(),
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
    expect(ensurePendingApprovalSession).toHaveBeenCalledWith(
      'approval_1',
      expect.objectContaining({
        runner,
        webContents,
        recoveryContext: expect.objectContaining({
          threadId: 'thread_3',
          maxOutputTokens: 512,
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
        maxIterations: 5,
        maxTokens: 512,
      })
    );
    expect(toolLoopStreamMock).toHaveBeenCalledWith(
      expect.objectContaining({
        runner,
        history: [{ role: 'system', content: 'history' }],
        prompt: 'stream tool',
      })
    );
    expect(uiChunkEmitter.emitToolEvent).toHaveBeenCalledTimes(1);
    expect(activeStreams.size).toBe(0);
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
});
