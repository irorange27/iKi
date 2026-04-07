import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

type IpcHandler = (...args: unknown[]) => unknown | Promise<unknown>;

const { ipcHandlers, ipcHandleMock, shellOpenPathMock, mkdirMock } = vi.hoisted(() => ({
  ipcHandlers: new Map<string, IpcHandler>(),
  ipcHandleMock: vi.fn((channel: string, handler: IpcHandler) => {
    ipcHandlers.set(channel, handler);
  }),
  shellOpenPathMock: vi.fn(),
  mkdirMock: vi.fn(),
}));

const { loggerEventMock } = vi.hoisted(() => ({
  loggerEventMock: vi.fn(),
}));

const { getAppConfigMock } = vi.hoisted(() => ({
  getAppConfigMock: vi.fn(() => ({
    general: {
      autoApproveToolRequests: false,
    },
  })),
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: ipcHandleMock,
  },
  shell: {
    openPath: shellOpenPathMock,
  },
}));

vi.mock('../../../src/core/logger', () => ({
  createLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    event: loggerEventMock,
    span: vi.fn(),
  })),
}));

vi.mock('../../../src/core/config', () => ({
  getAppConfig: getAppConfigMock,
}));

vi.mock('node:fs/promises', () => ({
  default: {
    mkdir: mkdirMock,
  },
}));

vi.mock('../../../src/core/skills', () => ({
  getSkillFolderPath: vi.fn(),
  getSkillRootsForUi: vi.fn(),
  listSkills: vi.fn(),
  readSkillContent: vi.fn(),
}));

vi.mock('../../../src/core/tools', () => ({
  defaultToolRegistry: {
    getToolMetadata: vi.fn(),
  },
}));

vi.mock('../../../src/main/services/workflow/workflow_optimizer', () => ({
  resetWorkflowOptimizationState: vi.fn(),
}));

vi.mock('../../../src/main/services/speech/speech_service', () => ({
  downloadWhisperNodeModel: vi.fn(),
  getSpeechStatus: vi.fn(),
  listWhisperNodeModels: vi.fn(),
  transcribeSpeech: vi.fn(),
}));

vi.mock('../../../src/core/provider/tool_model', () => ({
  getToolModel: vi.fn(),
  generateTitleWithAgent: vi.fn(),
  testToolModelLatency: vi.fn(),
}));

import { registerSkillsIpc } from '../../../src/main/ipc/skills';
import { registerSpeechIpc } from '../../../src/main/ipc/speech';
import { registerToolModelIpc } from '../../../src/main/ipc/tool_model';
import { registerToolsIpc } from '../../../src/main/ipc/tools';
import { registerWorkflowIpc } from '../../../src/main/ipc/workflow';
import {
  getSkillFolderPath,
  getSkillRootsForUi,
  listSkills,
  readSkillContent,
} from '../../../src/core/skills';
import { defaultToolRegistry } from '../../../src/core/tools';
import { resetWorkflowOptimizationState } from '../../../src/main/services/workflow/workflow_optimizer';
import {
  downloadWhisperNodeModel,
  getSpeechStatus,
  listWhisperNodeModels,
  transcribeSpeech,
} from '../../../src/main/services/speech/speech_service';
import {
  generateTitleWithAgent,
  getToolModel,
  testToolModelLatency,
} from '../../../src/core/provider/tool_model';
import { getAppConfig } from '../../../src/core/config';

const getSkillFolderPathMock = vi.mocked(getSkillFolderPath);
const getSkillRootsForUiMock = vi.mocked(getSkillRootsForUi);
const listSkillsMock = vi.mocked(listSkills);
const readSkillContentMock = vi.mocked(readSkillContent);
const getToolMetadataMock = vi.mocked(defaultToolRegistry.getToolMetadata);
const resetWorkflowOptimizationStateMock = vi.mocked(resetWorkflowOptimizationState);
const downloadWhisperNodeModelMock = vi.mocked(downloadWhisperNodeModel);
const getSpeechStatusMock = vi.mocked(getSpeechStatus);
const listWhisperNodeModelsMock = vi.mocked(listWhisperNodeModels);
const transcribeSpeechMock = vi.mocked(transcribeSpeech);
const generateTitleWithAgentMock = vi.mocked(generateTitleWithAgent);
const getToolModelMock = vi.mocked(getToolModel);
const testToolModelLatencyMock = vi.mocked(testToolModelLatency);
const getAppConfigRuntimeMock = vi.mocked(getAppConfig);

beforeAll(() => {
  registerSkillsIpc();
  registerToolsIpc();
  registerWorkflowIpc();
  registerSpeechIpc();
  registerToolModelIpc();
});

beforeEach(() => {
  vi.clearAllMocks();
  getAppConfigRuntimeMock.mockReturnValue({
    general: {
      autoApproveToolRequests: false,
    },
  } as never);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('system IPC modules', () => {
  it('keeps repeated registration idempotent for skills/tools/workflow/speech/tool model', () => {
    const initialCount = ipcHandleMock.mock.calls.length;

    registerSkillsIpc();
    registerToolsIpc();
    registerWorkflowIpc();
    registerSpeechIpc();
    registerToolModelIpc();

    expect(ipcHandleMock).toHaveBeenCalledTimes(initialCount);
  });

  it('handles skill listing/root discovery fallbacks and opens skill directories through the shell', async () => {
    listSkillsMock.mockResolvedValueOnce([{ id: 'skill_1' } as never]);
    expect(await ipcHandlers.get('skills:list')?.(null)).toEqual([{ id: 'skill_1' }]);

    const listError = new Error('list failed');
    listSkillsMock.mockRejectedValueOnce(listError);
    expect(await ipcHandlers.get('skills:list')?.(null)).toEqual([]);
    expect(loggerEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'error',
        event: 'ipc.skills.list',
        outcome: 'failed',
        error: listError,
      })
    );

    getSkillRootsForUiMock.mockReturnValueOnce([{ source: 'user', path: '/skills/user' } as never]);
    expect(await ipcHandlers.get('skills:roots')?.(null)).toEqual([
      { source: 'user', path: '/skills/user' },
    ]);

    const rootsError = new Error('roots failed');
    getSkillRootsForUiMock.mockImplementationOnce(() => {
      throw rootsError;
    });
    expect(await ipcHandlers.get('skills:roots')?.(null)).toEqual([]);
    expect(loggerEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'error',
        event: 'ipc.skills.roots',
        outcome: 'failed',
        error: rootsError,
      })
    );

    getSkillRootsForUiMock.mockReturnValue([{ source: 'user', path: '/skills/user' } as never]);
    mkdirMock.mockResolvedValue(undefined);
    shellOpenPathMock.mockResolvedValue('');
    expect(await ipcHandlers.get('skills:open-root')?.(null, 'codex')).toEqual({
      success: true,
      path: '/skills/user',
    });
    expect(mkdirMock).toHaveBeenCalledWith('/skills/user', { recursive: true });
    expect(shellOpenPathMock).toHaveBeenCalledWith('/skills/user');

    getSkillRootsForUiMock.mockReturnValue([{ source: 'codex', path: '' } as never]);
    expect(await ipcHandlers.get('skills:open-root')?.(null, 'codex')).toEqual({
      success: false,
      error: 'No skills folder configured',
    });

    getSkillFolderPathMock.mockResolvedValue('/skills/user/skill_1');
    shellOpenPathMock.mockResolvedValueOnce('Cannot open');
    expect(await ipcHandlers.get('skills:open-skill')?.(null, 'skill_1')).toEqual({
      success: false,
      error: 'Cannot open',
      path: '/skills/user/skill_1',
    });

    getSkillFolderPathMock.mockResolvedValue(null);
    expect(await ipcHandlers.get('skills:open-skill')?.(null, 'missing')).toEqual({
      success: false,
      error: 'Skill not found',
    });

    readSkillContentMock.mockResolvedValueOnce({
      id: 'skill_1',
      name: 'Skill',
      content: 'body',
    } as never);
    expect(await ipcHandlers.get('skills:read')?.(null, 'skill_1', { maxChars: 500 })).toEqual({
      success: true,
      id: 'skill_1',
      name: 'Skill',
      content: 'body',
    });

    readSkillContentMock.mockResolvedValueOnce(null);
    expect(await ipcHandlers.get('skills:read')?.(null, 'missing')).toEqual({
      success: false,
      error: 'Skill not found',
    });

    readSkillContentMock.mockRejectedValueOnce('read failed');
    expect(await ipcHandlers.get('skills:read')?.(null, 'skill_1')).toEqual({
      success: false,
      error: 'read failed',
    });
  });

  it('lists tools and falls back to an empty set when metadata resolution fails', async () => {
    getToolMetadataMock.mockReturnValueOnce([{ name: 'web' } as never]);
    expect(await ipcHandlers.get('tools:list')?.(null)).toEqual([{ name: 'web' }]);

    getAppConfigRuntimeMock.mockReturnValueOnce({
      general: {
        autoApproveToolRequests: true,
      },
    } as never);
    getToolMetadataMock.mockReturnValueOnce([{ name: 'shell', needsApproval: true } as never]);
    expect(await ipcHandlers.get('tools:list')?.(null)).toEqual([
      { name: 'shell', needsApproval: false },
    ]);

    getAppConfigRuntimeMock.mockReturnValueOnce({
      general: {
        autoApproveToolRequests: true,
      },
    } as never);
    getToolMetadataMock.mockReturnValueOnce([
      { name: 'write_personal_skill', needsApproval: true, approvalMode: 'always' } as never,
    ]);
    expect(await ipcHandlers.get('tools:list')?.(null)).toEqual([
      { name: 'write_personal_skill', needsApproval: true, approvalMode: 'always' },
    ]);

    const metadataError = new Error('metadata failed');
    getToolMetadataMock.mockImplementationOnce(() => {
      throw metadataError;
    });
    expect(await ipcHandlers.get('tools:list')?.(null)).toEqual([]);
    expect(loggerEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'error',
        event: 'ipc.tools.list',
        outcome: 'failed',
        error: metadataError,
      })
    );
  });

  it('resets workflow optimization state and returns structured failure details on error', async () => {
    expect(await ipcHandlers.get('workflow:reset-auto-skills')?.(null)).toEqual({ success: true });
    expect(resetWorkflowOptimizationStateMock).toHaveBeenCalledTimes(1);

    resetWorkflowOptimizationStateMock.mockImplementationOnce(() => {
      throw new Error('reset failed');
    });
    expect(await ipcHandlers.get('workflow:reset-auto-skills')?.(null)).toEqual({
      success: false,
      error: 'reset failed',
    });
  });

  it('exposes speech service status/transcription/model-download flows and fallbacks', async () => {
    const sender = { send: vi.fn() };

    getSpeechStatusMock.mockReturnValueOnce({ available: true, enabled: true } as never);
    expect(await ipcHandlers.get('speech:get-status')?.(null)).toEqual({
      available: true,
      enabled: true,
    });

    const statusError = new Error('status failed');
    getSpeechStatusMock.mockImplementationOnce(() => {
      throw statusError;
    });
    expect(await ipcHandlers.get('speech:get-status')?.(null)).toEqual({
      available: false,
      reason: 'Speech service unavailable',
    });
    expect(loggerEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'error',
        event: 'ipc.speech.get_status',
        outcome: 'failed',
        error: statusError,
      })
    );

    const input = { audioBase64: 'ZmFrZQ==', mimeType: 'audio/webm' };
    transcribeSpeechMock.mockResolvedValueOnce({ text: 'hello' } as never);
    expect(await ipcHandlers.get('speech:transcribe')?.(null, input)).toEqual({ text: 'hello' });
    expect(transcribeSpeechMock).toHaveBeenCalledWith(input);

    const transcribeError = new Error('transcribe failed');
    transcribeSpeechMock.mockRejectedValueOnce(transcribeError);
    await expect(ipcHandlers.get('speech:transcribe')?.(null, input)).rejects.toThrow(
      'transcribe failed'
    );
    expect(loggerEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'error',
        event: 'ipc.speech.transcribe',
        outcome: 'failed',
        error: transcribeError,
      })
    );

    listWhisperNodeModelsMock.mockReturnValueOnce([{ name: 'base.en' } as never]);
    expect(await ipcHandlers.get('speech:list-models')?.(null)).toEqual([{ name: 'base.en' }]);

    const modelsError = new Error('models failed');
    listWhisperNodeModelsMock.mockImplementationOnce(() => {
      throw modelsError;
    });
    expect(await ipcHandlers.get('speech:list-models')?.(null)).toEqual([]);
    expect(loggerEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'error',
        event: 'ipc.speech.list_models',
        outcome: 'failed',
        error: modelsError,
      })
    );

    downloadWhisperNodeModelMock.mockImplementationOnce(async (_modelName, onProgress) => {
      onProgress?.({ model: 'base.en', phase: 'download', percent: 50 } as never);
      return { success: true, model: 'base.en' } as never;
    });
    expect(await ipcHandlers.get('speech:download-model')?.({ sender }, 'base.en')).toEqual({
      success: true,
      model: 'base.en',
    });
    expect(sender.send).toHaveBeenCalledWith('speech:download-progress', {
      model: 'base.en',
      phase: 'download',
      percent: 50,
    });

    const downloadError = new Error('download failed');
    downloadWhisperNodeModelMock.mockRejectedValueOnce(downloadError);
    expect(await ipcHandlers.get('speech:download-model')?.({ sender }, 'large-v3')).toEqual({
      model: 'large-v3',
      success: false,
      error: 'download failed',
    });
    expect(loggerEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'error',
        event: 'ipc.speech.download_model',
        outcome: 'failed',
        error: downloadError,
      })
    );
  });

  it('returns tool-model config and title-generation fallbacks when provider selection fails', async () => {
    getToolModelMock.mockReturnValueOnce({
      providerId: 'provider-openai',
      providerType: 'openai',
      model: 'gpt-4o-mini',
    } as never);
    expect(await ipcHandlers.get('toolModel:get')?.(null)).toEqual({
      providerId: 'provider-openai',
      providerType: 'openai',
      model: 'gpt-4o-mini',
    });

    const getError = new Error('tool model failed');
    getToolModelMock.mockImplementationOnce(() => {
      throw getError;
    });
    expect(await ipcHandlers.get('toolModel:get')?.(null)).toBeNull();
    expect(loggerEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'error',
        event: 'ipc.tool_model.get',
        outcome: 'failed',
        error: getError,
      })
    );

    generateTitleWithAgentMock.mockResolvedValueOnce('Generated Title');
    expect(await ipcHandlers.get('toolModel:generateTitle')?.(null, 'Conversation')).toBe(
      'Generated Title'
    );

    const titleError = new Error('title failed');
    generateTitleWithAgentMock.mockRejectedValueOnce(titleError);
    expect(await ipcHandlers.get('toolModel:generateTitle')?.(null, 'Conversation')).toBeNull();
    expect(loggerEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'error',
        event: 'ipc.tool_model.generate_title',
        outcome: 'failed',
        error: titleError,
      })
    );

    testToolModelLatencyMock.mockResolvedValueOnce({
      providerId: 'provider-openai',
      providerType: 'openai',
      model: 'gpt-4o-mini',
      responseTimeMs: 1234,
    } as never);
    expect(
      await ipcHandlers.get('toolModel:testLatency')?.(null, {
        providerId: 'provider-openai',
        model: 'gpt-4o-mini',
      })
    ).toEqual({
      success: true,
      providerId: 'provider-openai',
      providerType: 'openai',
      model: 'gpt-4o-mini',
      responseTimeMs: 1234,
    });

    const latencyError = new Error('latency failed');
    testToolModelLatencyMock.mockRejectedValueOnce(latencyError);
    expect(await ipcHandlers.get('toolModel:testLatency')?.(null, null)).toEqual({
      success: false,
      error: 'latency failed',
    });
    expect(loggerEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'error',
        event: 'ipc.tool_model.test_latency',
        outcome: 'failed',
        error: latencyError,
      })
    );
  });
});
