import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { platform, tmpdir } from 'node:os';
import path from 'node:path';
import { getNativeClipboard } from '@earendil-works/pi-tui';
import { rebuildThreadViewFromEvents } from '@iki/harness/thread_session/session_log';

const MAX_OSC52_ENCODED_LENGTH = 100_000;
const MAX_CLIPBOARD_BYTES = 50 * 1024 * 1024;
const CONTROL_CHAR_RE = /\p{Cc}/u;

const runClipboardCommand = (
  command: string,
  args: readonly string[],
  options?: { input?: string; timeoutMs?: number }
): Promise<Buffer | undefined> =>
  new Promise(resolve => {
    const child = spawn(command, args, {
      stdio: ['pipe', options?.input === undefined ? 'pipe' : 'ignore', 'ignore'],
      cwd: '/',
      detached: process.platform !== 'win32',
      windowsHide: true,
    });
    const chunks: Buffer[] = [];
    let length = 0;
    let settled = false;
    const finish = (result: Buffer | undefined): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const abort = (): void => {
      child.kill('SIGKILL');
      child.stdout?.destroy();
      child.stdin?.destroy();
      finish(undefined);
    };
    const timer = setTimeout(abort, options?.timeoutMs ?? 3000);
    child.on('error', () => finish(undefined));
    child.on('close', code => {
      if (!settled) finish(code === 0 ? Buffer.concat(chunks, length) : undefined);
    });
    child.stdout?.on('data', (chunk: Buffer) => {
      if (settled) return;
      length += chunk.length;
      if (length > MAX_CLIPBOARD_BYTES) abort();
      else chunks.push(chunk);
    });
    child.stdin?.on('error', () => {
      // Clipboard writer may exit before consuming all stdin.
    });
    child.stdin?.end(options?.input);
  });

const isRemoteSession = (env: NodeJS.ProcessEnv): boolean =>
  Boolean(
    env.SSH_CONNECTION ||
      env.SSH_CLIENT ||
      env.MOSH_CONNECTION ||
      env.IKI_CLIPBOARD_OSC52 === '1'
  );

const isWsl = (env: NodeJS.ProcessEnv): boolean =>
  Boolean(env.WSL_DISTRO_NAME || env.WSL_INTEROP);

const emitOsc52 = (text: string): boolean => {
  const encoded = Buffer.from(text).toString('base64');
  if (encoded.length > MAX_OSC52_ENCODED_LENGTH) return false;
  process.stdout.write(`\x1b]52;c;${encoded}\x07`);
  return true;
};

const copyViaWslWindowsClipboard = async (text: string): Promise<boolean> => {
  const tmpFile = path.join(tmpdir(), `iki-wsl-clip-${randomUUID()}.txt`);
  try {
    fs.writeFileSync(tmpFile, text, { encoding: 'utf8', mode: 0o600 });
    const winPath = (await runClipboardCommand('wslpath', ['-w', tmpFile], { timeoutMs: 1000 }))
      ?.toString('utf8')
      .trim();
    if (!winPath) return false;
    const script = `Set-Clipboard -Value ([System.IO.File]::ReadAllText('${winPath.replaceAll("'", "''")}', [System.Text.Encoding]::UTF8))`;
    const result = await runClipboardCommand(
      'powershell.exe',
      ['-NoProfile', '-Command', script],
      { timeoutMs: 5000 }
    );
    return result !== undefined;
  } catch {
    return false;
  } finally {
    try {
      fs.unlinkSync(tmpFile);
    } catch {
      // Temp file may not have been created.
    }
  }
};

/** Writes plain text to the system clipboard using native bindings, OS CLI fallbacks, and OSC 52 for remote/headless terminals. */
export const copyToClipboard = async (text: string): Promise<void> => {
  const p = platform();
  const env = process.env;
  let copied = false;

  if (p !== 'linux') {
    try {
      const native = getNativeClipboard();
      if (native?.setText) {
        await native.setText(text);
        copied = true;
      }
    } catch {
      // Fall through to OS clipboard CLI tools.
    }
  }

  if (!copied) {
    const commands: Array<[string, string[]]> = [];
    if (p === 'darwin') commands.push(['pbcopy', []]);
    else if (p === 'win32') commands.push(['clip', []]);
    else {
      if (env.TERMUX_VERSION) commands.push(['termux-clipboard-set', []]);
      if (env.WAYLAND_DISPLAY) commands.push(['wl-copy', []]);
      if (env.DISPLAY) {
        commands.push(['xclip', ['-selection', 'clipboard']], ['xsel', ['--clipboard', '--input']]);
      }
    }
    for (const [command, args] of commands) {
      if ((await runClipboardCommand(command, args, { input: text, timeoutMs: 5000 })) !== undefined) {
        copied = true;
        break;
      }
    }
  }

  let osc52Emitted = false;
  if (!copied && p === 'linux' && isWsl(env)) {
    if (env.WT_SESSION) osc52Emitted = emitOsc52(text);
    copied = osc52Emitted || (await copyViaWslWindowsClipboard(text));
  }

  const headless = p === 'linux' && !env.DISPLAY && !env.WAYLAND_DISPLAY && !env.TERMUX_VERSION;
  let oversized = false;
  if (!osc52Emitted && (isRemoteSession(env) || (!copied && headless))) {
    if (emitOsc52(text)) copied = true;
    else oversized = true;
  }

  if (copied) return;
  if (oversized) throw new Error('Clipboard unavailable: text exceeds the OSC 52 size limit');
  if (p === 'linux') {
    if (env.WAYLAND_DISPLAY) {
      throw new Error('Clipboard unavailable: install wl-clipboard (wl-copy) or check Wayland access');
    }
    if (env.DISPLAY) {
      throw new Error('Clipboard unavailable: install xclip or xsel, or check X11 access');
    }
  }
  throw new Error('Clipboard unavailable');
};

/** Reads plain text from the system clipboard. */
export const readClipboardText = async (): Promise<string | null> => {
  const p = platform();
  const env = process.env;
  const preNativeCommands: Array<[string, string[]]> = [];
  if (env.TERMUX_VERSION) preNativeCommands.push(['termux-clipboard-get', []]);
  if (p === 'linux') {
    if (env.WAYLAND_DISPLAY) preNativeCommands.push(['wl-paste', ['--no-newline', '--type', 'text']]);
    if (env.DISPLAY) {
      preNativeCommands.push(
        ['xclip', ['-selection', 'clipboard', '-out']],
        ['xsel', ['--clipboard', '--output']]
      );
    }
  }
  for (const [command, args] of preNativeCommands) {
    const bytes = await runClipboardCommand(command, args, { timeoutMs: 5000 });
    if (bytes !== undefined) return bytes.toString('utf8') || null;
  }

  try {
    const text = await getNativeClipboard()?.getText();
    if (text) return text;
  } catch {
    // Fall through to OS CLI reader fallback.
  }

  const fallbackCommands: Array<[string, string[]]> = [];
  if (p === 'darwin') fallbackCommands.push(['pbpaste', []]);
  else if (p === 'win32') {
    fallbackCommands.push(['powershell.exe', ['-NoProfile', '-Command', 'Get-Clipboard -Raw']]);
  }
  for (const [command, args] of fallbackCommands) {
    const bytes = await runClipboardCommand(command, args, { timeoutMs: 5000 });
    if (bytes !== undefined) return bytes.toString('utf8') || null;
  }
  return null;
};

/** Reads copied file paths (e.g. macOS Finder file copies) from the native clipboard. */
export const readClipboardFilePaths = async (): Promise<string[] | null> => {
  try {
    const paths = await getNativeClipboard()?.getFilePaths?.();
    if (!paths || paths.length === 0) return null;
    if (paths.some(filePath => CONTROL_CHAR_RE.test(filePath))) {
      throw new Error('Clipboard file path contains control characters');
    }
    return paths;
  } catch (error) {
    if (error instanceof Error && error.message.includes('control characters')) throw error;
    return null;
  }
};

const extractAssistantText = (parts: unknown): string => {
  if (!Array.isArray(parts)) return '';
  return parts
    .filter(
      (part): part is { type: string; text: string } =>
        Boolean(part) &&
        typeof part === 'object' &&
        (part as { type?: unknown }).type === 'text' &&
        typeof (part as { text?: unknown }).text === 'string'
    )
    .map(part => part.text)
    .join('\n')
    .trim();
};

/** Copies the latest non-empty assistant response in a thread to the system clipboard. */
export const copyLastAssistantReply = async (threadId: string): Promise<string> => {
  const view = rebuildThreadViewFromEvents(threadId);
  for (let i = view.messages.length - 1; i >= 0; i -= 1) {
    const msg = view.messages[i];
    if (msg.role !== 'assistant') continue;
    const text = extractAssistantText(msg.parts);
    if (!text) continue;
    try {
      await copyToClipboard(text);
      return `Copied last assistant reply (${text.length} chars) to clipboard.`;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  }
  return 'No assistant reply to copy in this thread.';
};
