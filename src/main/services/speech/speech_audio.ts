import { promises as fs, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const runFfmpeg = async (args: string[], ffmpegPath: string): Promise<void> => {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', data => {
      stderr += data.toString();
    });
    child.on('error', err => {
      reject(err);
    });
    child.on('close', code => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(stderr || `ffmpeg exited with code ${code}`));
      }
    });
  });
};

const resolvePackagedExecutablePath = (candidatePath: string): string => {
  const asarSegment = `${path.sep}app.asar${path.sep}`;
  if (!candidatePath.includes(asarSegment)) return candidatePath;

  const unpackedPath = candidatePath.replace(asarSegment, `${path.sep}app.asar.unpacked${path.sep}`);
  return existsSync(unpackedPath) ? unpackedPath : candidatePath;
};

const resolveFfmpegPath = (): string | null => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const ffmpegStatic = require('ffmpeg-static') as unknown;
    if (typeof ffmpegStatic === 'string' && ffmpegStatic.trim()) {
      return resolvePackagedExecutablePath(ffmpegStatic);
    }
  } catch {
    // ignore
  }
  return null;
};

export const resolveAvailableFfmpegPath = (): string | null => {
  const bundled = resolveFfmpegPath();
  if (bundled) return bundled;
  try {
    const probe = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    if (probe.status === 0) return 'ffmpeg';
  } catch {
    // ignore
  }
  return null;
};

export const getAudioExtension = (mimeType?: string): string => {
  const normalized = typeof mimeType === 'string' ? mimeType.toLowerCase() : '';
  if (normalized.includes('wav')) return 'wav';
  if (normalized.includes('mpeg') || normalized.includes('mp3')) return 'mp3';
  if (normalized.includes('ogg')) return 'ogg';
  if (normalized.includes('mp4') || normalized.includes('m4a')) return 'm4a';
  if (normalized.includes('webm')) return 'webm';
  return 'audio';
};

const ensureTempDir = async (): Promise<string> => {
  const dir = path.join(os.tmpdir(), 'iki-speech');
  await fs.mkdir(dir, { recursive: true });
  return dir;
};

export const writeTempFile = async (buffer: Buffer, extension: string): Promise<string> => {
  const dir = await ensureTempDir();
  const safeExt = extension.replace(/[^a-z0-9]/gi, '') || 'audio';
  const filename = `speech_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${safeExt}`;
  const filePath = path.join(dir, filename);
  await fs.writeFile(filePath, buffer);
  return filePath;
};

export const convertToWav = async (inputPath: string, ffmpegPath: string): Promise<string> => {
  const outputPath = inputPath.replace(/\.[^/.]+$/, '') + '_16k.wav';
  await runFfmpeg(['-y', '-i', inputPath, '-ac', '1', '-ar', '16000', outputPath], ffmpegPath);
  return outputPath;
};
