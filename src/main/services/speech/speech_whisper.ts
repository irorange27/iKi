import { promises as fs, existsSync, statSync, createWriteStream } from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import type { AppConfig } from '../../../shared/types/config';
import type {
  SpeechStatus,
  SpeechTranscriptionInput,
  SpeechTranscriptionResult,
  WhisperNodeDownloadProgress,
  WhisperNodeDownloadResult,
  WhisperNodeModelInfo,
} from '../../../shared/types/speech';
import {
  DEFAULT_WHISPER_MODEL_BASE_URL,
  FALLBACK_WHISPER_MODEL_BASE_URLS,
  getSpeechConfig,
  resolveWhisperNodeModelName,
} from './speech_config';
import {
  convertToWav,
  getAudioExtension,
  resolveAvailableFfmpegPath,
  writeTempFile,
} from './speech_audio';

type WhisperNodeTranscribe = (filePath: string, options?: unknown) => Promise<unknown>;

const WHISPER_NODE_MODELS: Array<Omit<WhisperNodeModelInfo, 'downloaded'>> = [
  { name: 'tiny', fileName: 'ggml-tiny.bin', sizeMB: 75, ramGB: 0.39 },
  { name: 'tiny.en', fileName: 'ggml-tiny.en.bin', sizeMB: 75, ramGB: 0.39 },
  { name: 'base', fileName: 'ggml-base.bin', sizeMB: 142, ramGB: 0.5 },
  { name: 'base.en', fileName: 'ggml-base.en.bin', sizeMB: 142, ramGB: 0.5 },
  { name: 'small', fileName: 'ggml-small.bin', sizeMB: 466, ramGB: 1.0 },
  { name: 'small.en', fileName: 'ggml-small.en.bin', sizeMB: 466, ramGB: 1.0 },
  { name: 'medium', fileName: 'ggml-medium.bin', sizeMB: 1500, ramGB: 2.6 },
  { name: 'medium.en', fileName: 'ggml-medium.en.bin', sizeMB: 1500, ramGB: 2.6 },
  { name: 'large-v3-turbo', fileName: 'ggml-large-v3-turbo.bin', sizeMB: 1600, ramGB: 3.2 },
];

const WHISPER_NODE_MODEL_MAP = new Map(WHISPER_NODE_MODELS.map(model => [model.name, model]));

const getWhisperNodeRoot = () => {
  try {
    return path.dirname(require.resolve('whisper-node/package.json'));
  } catch {
    return path.join(process.cwd(), 'node_modules', 'whisper-node');
  }
};

const getWhisperCppRoot = () => path.join(getWhisperNodeRoot(), 'lib', 'whisper.cpp');

const getWhisperModelsDir = () => path.join(getWhisperCppRoot(), 'models');

const getWhisperMainBinaryName = () => (process.platform === 'win32' ? 'main.exe' : 'main');

const getWhisperMainBinaryPath = () => path.join(getWhisperCppRoot(), getWhisperMainBinaryName());

const resolveWhisperModelSpec = (modelName: string) => WHISPER_NODE_MODEL_MAP.get(modelName);

const resolveWhisperModelPath = (modelName: string): string | null => {
  const spec = resolveWhisperModelSpec(modelName);
  if (!spec) return null;
  return path.join(getWhisperModelsDir(), spec.fileName);
};

const resolveCustomWhisperModelPath = (modelName: string): string | null => {
  const trimmed = modelName.trim();
  if (!trimmed) return null;
  const candidates = new Set<string>();
  candidates.add(trimmed);
  if (!path.isAbsolute(trimmed)) {
    candidates.add(path.join(getWhisperModelsDir(), trimmed));
  }
  candidates.add(path.join(getWhisperModelsDir(), `ggml-${trimmed}.bin`));
  candidates.add(path.join(getWhisperModelsDir(), `${trimmed}.bin`));
  candidates.add(path.join(getWhisperModelsDir(), `ggml-${trimmed}.gguf`));
  candidates.add(path.join(getWhisperModelsDir(), `${trimmed}.gguf`));
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
};

const getExpectedModelBytes = (modelName: string): number | null => {
  const spec = resolveWhisperModelSpec(modelName);
  if (!spec) return null;
  return Math.round(spec.sizeMB * 1024 * 1024);
};

const checkWhisperModelFile = (
  filePath: string,
  expectedBytes?: number | null
): { valid: boolean; reason?: string } => {
  try {
    if (!existsSync(filePath)) {
      return { valid: false, reason: 'Model file not found' };
    }
    const stats = statSync(filePath);
    if (stats.size < 1024 * 1024) {
      return { valid: false, reason: 'Model file too small' };
    }
    if (expectedBytes && stats.size < expectedBytes * 0.8) {
      return { valid: false, reason: 'Model file incomplete' };
    }
    return { valid: true };
  } catch (error: unknown) {
    return {
      valid: false,
      reason: error instanceof Error ? error.message : 'Model file invalid',
    };
  }
};

const resolveNodeBinaryFromPath = (): string | null => {
  const command = process.platform === 'win32' ? 'where' : 'which';
  try {
    const result = spawnSync(command, ['node'], { encoding: 'utf8' });
    if (result.status === 0) {
      const output = String(result.stdout ?? '');
      const first = output.split(/\r?\n/).find(line => line.trim().length > 0);
      if (first && existsSync(first.trim())) return first.trim();
    }
  } catch {
    // ignore
  }
  return null;
};

const configureShelljsExecPath = () => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const shelljs = require('shelljs') as { config?: { execPath?: string } };
    if (!shelljs?.config) return;
    if (shelljs.config.execPath && shelljs.config.execPath.trim()) return;
    let execPath = '';
    if (process.execPath && /node(\.exe)?$/i.test(process.execPath)) {
      execPath = process.execPath;
    }
    if (!execPath) {
      execPath = resolveNodeBinaryFromPath() || '';
    }
    if (!execPath && process.versions.electron) {
      process.env.ELECTRON_RUN_AS_NODE = process.env.ELECTRON_RUN_AS_NODE || '1';
      execPath = process.execPath;
    }
    if (execPath) {
      shelljs.config.execPath = execPath;
    }
  } catch {
    // ignore
  }
};

const normalizeWhisperLanguage = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) return 'auto';
  const lower = trimmed.toLowerCase();
  if (lower === 'auto') return 'auto';
  if (trimmed === '中文' || trimmed === '汉语' || trimmed === '普通话' || lower === 'chinese') {
    return 'zh';
  }
  const normalized = lower.replace('_', '-');
  if (['zh-cn', 'zh-hans', 'zh-hant', 'zh-tw', 'zh-hk', 'zh-mo'].includes(normalized)) {
    return 'zh';
  }
  if (['en-us', 'en-gb', 'en-uk', 'english'].includes(normalized)) {
    return 'en';
  }
  if (normalized.includes('-')) {
    return normalized.split('-')[0] || normalized;
  }
  return normalized;
};

const runCommand = async (
  command: string,
  args: string[],
  options: { cwd: string; shell?: boolean }
): Promise<void> => {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      shell: options.shell ?? false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', data => {
      output += data.toString();
    });
    child.stderr.on('data', data => {
      output += data.toString();
    });
    child.on('error', err => {
      reject(err);
    });
    child.on('close', code => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(output.trim() || `Command failed with exit code ${code}`));
      }
    });
  });
};

const ensureWhisperCppReady = async () => {
  const mainBinaryPath = getWhisperMainBinaryPath();
  if (existsSync(mainBinaryPath)) return;
  const whisperRoot = getWhisperCppRoot();
  try {
    await runCommand('make', [], { cwd: whisperRoot, shell: true });
  } catch (error: unknown) {
    const detail = error instanceof Error ? ` ${error.message}` : '';
    throw new Error(
      `whisper.cpp build failed. Please install build tools and run "make" in ${whisperRoot}.${detail}`
    );
  }
  if (!existsSync(mainBinaryPath)) {
    throw new Error('whisper.cpp build failed. main binary not found after compilation.');
  }
};

const normalizeDownloadBaseUrl = (value: string): string => value.replace(/\/+$/, '');

const resolveWhisperDownloadUrls = (config: AppConfig['speech'], modelName: string): string[] => {
  const candidates = [
    config.downloadBaseUrl?.trim(),
    process.env.WHISPER_MODEL_BASE_URL,
    DEFAULT_WHISPER_MODEL_BASE_URL,
  ].filter((value): value is string => !!value && value.trim().length > 0);

  if (!config.downloadBaseUrl) {
    candidates.push(...FALLBACK_WHISPER_MODEL_BASE_URLS);
  }

  const unique = new Set<string>();
  for (const base of candidates) {
    unique.add(`${normalizeDownloadBaseUrl(base)}/ggml-${modelName}.bin`);
  }
  return Array.from(unique);
};

const writeStreamAsync = (stream: NodeJS.WritableStream): Promise<void> =>
  new Promise((resolve, reject) => {
    stream.on('finish', resolve);
    stream.on('error', reject);
  });

const downloadWhisperModelFromUrl = async (
  url: string,
  modelPath: string,
  expectedBytes: number | null,
  onProgress?: (downloadedBytes: number, totalBytes?: number) => void
) => {
  if (typeof fetch !== 'function') {
    throw new Error('Fetch API not available');
  }
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`Download failed (${response.status})`);
  }

  const totalHeader = response.headers.get('content-length');
  const totalBytes = totalHeader ? Number(totalHeader) : expectedBytes || undefined;
  const tempPath = `${modelPath}.download`;

  await fs.mkdir(path.dirname(modelPath), { recursive: true });
  const fileStream = createWriteStream(tempPath);
  let downloadedBytes = 0;
  try {
    const body = response.body as ReadableStream<Uint8Array> | null;
    const reader = body?.getReader?.();
    if (!reader) {
      throw new Error('Download stream not available');
    }
    let done = false;
    while (!done) {
      const { done: readerDone, value } = await reader.read();
      if (readerDone) {
        done = true;
        break;
      }
      if (value && value.length > 0) {
        downloadedBytes += value.length;
        if (!fileStream.write(Buffer.from(value))) {
          await new Promise<void>(resolve => fileStream.once('drain', () => resolve()));
        }
        onProgress?.(downloadedBytes, totalBytes);
      }
    }
    fileStream.end();
    await writeStreamAsync(fileStream);
    await fs.rename(tempPath, modelPath);
  } catch (error) {
    fileStream.destroy();
    try {
      await fs.unlink(tempPath);
    } catch {
      // ignore cleanup errors
    }
    throw error;
  }
};

const isWhisperNodeInstalled = (): boolean => {
  try {
    require.resolve('whisper-node');
    return true;
  } catch {
    return false;
  }
};

export const getWhisperNodeStatus = (config: AppConfig['speech']): SpeechStatus => {
  if (!isWhisperNodeInstalled()) {
    return {
      available: false,
      enabled: true,
      providerType: 'whisper-node',
      reason: 'whisper-node not installed',
    };
  }
  if (config.modelPath && config.modelPath.trim() && !existsSync(config.modelPath.trim())) {
    return {
      available: false,
      enabled: true,
      providerType: 'whisper-node',
      reason: 'Model path not found',
    };
  }
  if (!config.modelPath || !config.modelPath.trim()) {
    const modelName = resolveWhisperNodeModelName(config.model);
    const modelPath = resolveWhisperModelPath(modelName);
    const resolvedPath = modelPath || resolveCustomWhisperModelPath(modelName);
    if (!resolvedPath) {
      return {
        available: false,
        enabled: true,
        providerType: 'whisper-node',
        reason: 'Unknown whisper-node model. Use a custom model path.',
      };
    }
    if (!existsSync(resolvedPath)) {
      return {
        available: false,
        enabled: true,
        providerType: 'whisper-node',
        reason: 'Model not downloaded',
      };
    }
    const expectedBytes = modelPath ? getExpectedModelBytes(modelName) : null;
    const check = checkWhisperModelFile(resolvedPath, expectedBytes);
    if (!check.valid) {
      return {
        available: false,
        enabled: true,
        providerType: 'whisper-node',
        reason: check.reason || 'Model file invalid',
      };
    }
  }
  if (config.modelPath && config.modelPath.trim()) {
    const check = checkWhisperModelFile(config.modelPath.trim());
    if (!check.valid) {
      return {
        available: false,
        enabled: true,
        providerType: 'whisper-node',
        reason: check.reason || 'Model file invalid',
      };
    }
  }
  const ffmpegPath = resolveAvailableFfmpegPath();
  if (!ffmpegPath) {
    return {
      available: false,
      enabled: true,
      providerType: 'whisper-node',
      reason: 'ffmpeg not available',
    };
  }
  return {
    available: true,
    enabled: true,
    providerType: 'whisper-node',
    model: resolveWhisperNodeModelName(config.model),
    language: config.language || undefined,
    prompt: config.prompt || undefined,
  };
};

export const listWhisperNodeModels = (): WhisperNodeModelInfo[] => {
  const modelsDir = getWhisperModelsDir();
  return WHISPER_NODE_MODELS.map(model => ({
    ...model,
    ...(() => {
      const modelPath = path.join(modelsDir, model.fileName);
      const expectedBytes = Math.round(model.sizeMB * 1024 * 1024);
      const hasFile = existsSync(modelPath);
      const check = checkWhisperModelFile(modelPath, expectedBytes);
      const status: WhisperNodeModelInfo['status'] = check.valid
        ? 'ready'
        : hasFile
          ? 'invalid'
          : 'missing';
      return {
        downloaded: status === 'ready',
        status,
        error: status === 'invalid' ? check.reason : undefined,
      };
    })(),
  }));
};

export const downloadWhisperNodeModel = async (
  modelName: string,
  onProgress?: (payload: WhisperNodeDownloadProgress) => void
): Promise<WhisperNodeDownloadResult> => {
  configureShelljsExecPath();
  if (!isWhisperNodeInstalled()) {
    onProgress?.({ model: modelName, stage: 'error', message: 'whisper-node not installed' });
    return { model: modelName, success: false, error: 'whisper-node not installed' };
  }
  const spec = resolveWhisperModelSpec(modelName);
  if (!spec) {
    onProgress?.({ model: modelName, stage: 'error', message: 'Unknown whisper-node model' });
    return { model: modelName, success: false, error: 'Unknown whisper-node model' };
  }

  const modelsDir = getWhisperModelsDir();
  const modelPath = path.join(modelsDir, spec.fileName);
  const expectedBytes = Math.round(spec.sizeMB * 1024 * 1024);
  if (existsSync(modelPath)) {
    const check = checkWhisperModelFile(modelPath, expectedBytes);
    if (!check.valid) {
      try {
        await fs.unlink(modelPath);
      } catch {
        // ignore delete errors
      }
    }
  }
  const scriptName =
    process.platform === 'win32' ? 'download-ggml-model.cmd' : 'download-ggml-model.sh';
  const scriptPath = path.join(modelsDir, scriptName);

  try {
    onProgress?.({ model: modelName, stage: 'downloading', message: 'Downloading model...' });

    const urls = resolveWhisperDownloadUrls(getSpeechConfig(), modelName);
    let lastError: Error | null = null;
    for (const url of urls) {
      try {
        await downloadWhisperModelFromUrl(url, modelPath, expectedBytes, (downloaded, total) => {
          const progress = total ? Math.min(downloaded / total, 1) : undefined;
          onProgress?.({
            model: modelName,
            stage: 'downloading',
            progress,
            downloadedBytes: downloaded,
            totalBytes: total,
          });
        });
        lastError = null;
        break;
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Download failed';
        lastError = new Error(`Download failed from ${url}: ${message}`);
      }
    }

    if (lastError) {
      if (existsSync(scriptPath)) {
        onProgress?.({
          model: modelName,
          stage: 'downloading',
          message: 'Falling back to shell downloader...',
        });
        await runCommand(scriptPath, [modelName], { cwd: modelsDir, shell: true });
      } else {
        const hint = getSpeechConfig().downloadBaseUrl
          ? 'Check the download base URL.'
          : 'Configure a download mirror in Settings > Speech.';
        throw new Error(`${lastError.message}. ${hint}`);
      }
    }

    const whisperRoot = getWhisperCppRoot();
    const mainBinary = getWhisperMainBinaryName();
    if (!existsSync(path.join(whisperRoot, mainBinary))) {
      onProgress?.({ model: modelName, stage: 'compiling', message: 'Compiling whisper.cpp...' });
      await runCommand('make', [], { cwd: whisperRoot, shell: true });
    }

    const finalCheck = checkWhisperModelFile(modelPath, expectedBytes);
    if (!finalCheck.valid) {
      onProgress?.({
        model: modelName,
        stage: 'error',
        message: finalCheck.reason || 'Downloaded model invalid',
      });
      return {
        model: modelName,
        success: false,
        error: finalCheck.reason || 'Downloaded model invalid',
      };
    }

    onProgress?.({ model: modelName, stage: 'done', message: 'Model ready' });
    return { model: modelName, success: true };
  } catch (error: unknown) {
    onProgress?.({
      model: modelName,
      stage: 'error',
      message: error instanceof Error ? error.message : 'Download failed',
    });
    return {
      model: modelName,
      success: false,
      error: error instanceof Error ? error.message : 'Download failed',
    };
  }
};

const parseWhisperNodeOutput = (result: unknown): string => {
  if (typeof result === 'string') return result.trim();
  if (Array.isArray(result)) {
    return result
      .map(item => {
        if (!item || typeof item !== 'object' || !('speech' in item)) return '';
        const speech = (item as { speech?: unknown }).speech;
        return typeof speech === 'string' ? speech : '';
      })
      .filter((text: string) => text.trim().length > 0)
      .join(' ')
      .trim();
  }
  if (result && typeof result === 'object' && 'text' in result) {
    const text = (result as { text?: unknown }).text;
    return typeof text === 'string' ? text.trim() : '';
  }
  return '';
};

export const transcribeWithWhisperNode = async (
  config: AppConfig['speech'],
  input: SpeechTranscriptionInput
): Promise<SpeechTranscriptionResult> => {
  const ffmpegPath = resolveAvailableFfmpegPath();
  if (!ffmpegPath) {
    throw new Error('ffmpeg not available');
  }
  await ensureWhisperCppReady();
  configureShelljsExecPath();
  const extension = getAudioExtension(input.mimeType);
  const buffer = Buffer.from(input.audioBase64, 'base64');
  const inputPath = await writeTempFile(buffer, extension);
  let wavPath = '';
  try {
    wavPath = await convertToWav(inputPath, ffmpegPath);
    const whisperModule = require('whisper-node') as unknown;
    const whisper =
      typeof whisperModule === 'function'
        ? (whisperModule as WhisperNodeTranscribe)
        : (whisperModule as { default?: WhisperNodeTranscribe }).default;
    if (typeof whisper !== 'function') {
      throw new Error('whisper-node not available');
    }

    const modelPath = config.modelPath?.trim();
    const modelName = resolveWhisperNodeModelName(config.model);
    const languageInput = input.language || config.language || '';
    const language = normalizeWhisperLanguage(languageInput);
    const mappedPath = resolveWhisperModelPath(modelName);
    const customPath = resolveCustomWhisperModelPath(modelName);
    const effectivePath = modelPath || mappedPath || customPath;
    if (!effectivePath) {
      throw new Error('Unknown whisper-node model. Use a custom model path.');
    }
    const expectedBytes = modelPath || !mappedPath ? null : getExpectedModelBytes(modelName);
    const check = checkWhisperModelFile(effectivePath, expectedBytes);
    if (!check.valid) {
      throw new Error(check.reason || 'Model file invalid');
    }
    const whisperOptions: Record<string, unknown> = {
      word_timestamps: true,
      language,
    };
    const options: Record<string, unknown> = {
      whisperOptions,
    };
    options.modelPath = effectivePath;

    const result = await whisper(wavPath, options);
    if (!result) {
      throw new Error('whisper-node returned empty result');
    }
    const text = parseWhisperNodeOutput(result);

    return {
      text,
      providerType: 'whisper-node',
      model: modelPath || modelName,
    };
  } finally {
    try {
      await fs.unlink(inputPath);
    } catch {
      // ignore
    }
    if (wavPath) {
      try {
        await fs.unlink(wavPath);
      } catch {
        // ignore
      }
    }
  }
};
