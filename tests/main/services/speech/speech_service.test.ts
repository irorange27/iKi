import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const {
  getSpeechConfigMock,
  getWhisperNodeStatusMock,
  transcribeWithWhisperNodeMock,
  normalizeOpenAiBaseUrlMock,
  getAudioExtensionMock,
} = vi.hoisted(() => ({
  getSpeechConfigMock: vi.fn(),
  getWhisperNodeStatusMock: vi.fn(),
  transcribeWithWhisperNodeMock: vi.fn(),
  normalizeOpenAiBaseUrlMock: vi.fn((value?: string) => {
    const trimmed = typeof value === 'string' ? value.trim() : '';
    return trimmed || 'https://api.openai.com/v1';
  }),
  getAudioExtensionMock: vi.fn(() => 'webm'),
}));

vi.mock('../../../../src/main/services/speech/speech_config', () => ({
  DEFAULT_OPENAI_MODEL: 'whisper-1',
  getSpeechConfig: getSpeechConfigMock,
  normalizeOpenAiBaseUrl: normalizeOpenAiBaseUrlMock,
}));

vi.mock('../../../../src/main/services/speech/speech_audio', () => ({
  getAudioExtension: getAudioExtensionMock,
}));

vi.mock('../../../../src/main/services/speech/speech_whisper', () => ({
  downloadWhisperNodeModel: vi.fn(),
  getWhisperNodeStatus: getWhisperNodeStatusMock,
  listWhisperNodeModels: vi.fn(() => []),
  transcribeWithWhisperNode: transcribeWithWhisperNodeMock,
}));

import { getSpeechStatus, transcribeSpeech } from '../../../../src/main/services/speech/speech_service';

type MockSpeechConfig = {
  enabled: boolean;
  providerType: 'openai' | 'whisper-node' | '';
  apiKey: string;
  baseUrl: string;
  downloadBaseUrl: string;
  model: string;
  modelPath: string;
  language: string;
  prompt: string;
};

const createConfig = (overrides?: Partial<MockSpeechConfig>): MockSpeechConfig => ({
  enabled: true,
  providerType: 'openai',
  apiKey: 'test-key',
  baseUrl: 'https://api.openai.com/v1',
  downloadBaseUrl: '',
  model: 'whisper-1',
  modelPath: '',
  language: '',
  prompt: '',
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  getSpeechConfigMock.mockReturnValue(createConfig());
  getWhisperNodeStatusMock.mockReturnValue({
    available: true,
    enabled: true,
    providerType: 'whisper-node',
    model: 'base.en',
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('getSpeechStatus', () => {
  it('returns unavailable when speech is disabled', () => {
    getSpeechConfigMock.mockReturnValue(createConfig({ enabled: false }));

    expect(getSpeechStatus()).toEqual({
      available: false,
      enabled: false,
      providerType: 'openai',
      reason: 'Speech input disabled',
    });
  });

  it('delegates to whisper-node status when whisper provider is selected', () => {
    getSpeechConfigMock.mockReturnValue(createConfig({ providerType: 'whisper-node' }));
    getWhisperNodeStatusMock.mockReturnValue({
      available: true,
      enabled: true,
      providerType: 'whisper-node',
      model: 'base.en',
    });

    const status = getSpeechStatus();

    expect(getWhisperNodeStatusMock).toHaveBeenCalledTimes(1);
    expect(status).toEqual({
      available: true,
      enabled: true,
      providerType: 'whisper-node',
      model: 'base.en',
    });
  });

  it('requires an API key for OpenAI speech provider', () => {
    getSpeechConfigMock.mockReturnValue(createConfig({ apiKey: ' ' }));

    expect(getSpeechStatus()).toEqual({
      available: false,
      enabled: true,
      providerType: 'openai',
      reason: 'Speech API key not configured',
    });
  });
});

describe('transcribeSpeech', () => {
  it('routes whisper-node transcription to whisper-node service', async () => {
    getSpeechConfigMock.mockReturnValue(createConfig({ providerType: 'whisper-node' }));
    getWhisperNodeStatusMock.mockReturnValue({
      available: true,
      enabled: true,
      providerType: 'whisper-node',
      model: 'base.en',
    });
    transcribeWithWhisperNodeMock.mockResolvedValue({
      text: 'hello from whisper',
      providerType: 'whisper-node',
      model: 'base.en',
    });

    const result = await transcribeSpeech({
      audioBase64: 'dGVzdA==',
      mimeType: 'audio/webm',
    });

    expect(transcribeWithWhisperNodeMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      text: 'hello from whisper',
      providerType: 'whisper-node',
      model: 'base.en',
    });
  });

  it('calls the OpenAI transcription endpoint and trims response text', async () => {
    getSpeechConfigMock.mockReturnValue(
      createConfig({
        providerType: 'openai',
        apiKey: 'secret',
        baseUrl: 'https://example.com/v1',
        model: 'whisper-1',
      })
    );
    normalizeOpenAiBaseUrlMock.mockReturnValue('https://example.com/v1');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ text: '  hello world  ' }),
    } as unknown as Response);
    vi.stubGlobal('fetch', fetchMock);

    const result = await transcribeSpeech({
      audioBase64: 'dGVzdA==',
      mimeType: 'audio/webm',
      language: 'en',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.com/v1/audio/transcriptions',
      expect.objectContaining({
        method: 'POST',
        headers: { Authorization: 'Bearer secret' },
      })
    );
    expect(result).toEqual({
      text: 'hello world',
      providerType: 'openai',
      model: 'whisper-1',
    });
  });

  it('throws a descriptive error when OpenAI transcription fails', async () => {
    getSpeechConfigMock.mockReturnValue(
      createConfig({
        providerType: 'openai',
        apiKey: 'secret',
      })
    );
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      text: async () => 'invalid_api_key',
    } as unknown as Response);
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      transcribeSpeech({
        audioBase64: 'dGVzdA==',
        mimeType: 'audio/webm',
      })
    ).rejects.toThrow('Speech transcription failed (401): invalid_api_key');
  });
});
