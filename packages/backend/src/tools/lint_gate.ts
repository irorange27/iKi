import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export type SyntaxCheckVerdict =
  | { status: 'ok' }
  | { status: 'skipped'; reason: string }
  | { status: 'failed'; checker: string; output: string };

const LINT_TIMEOUT_MS = 5_000;
const MAX_LINT_OUTPUT_CHARS = 2_000;

const runChecker = (
  command: string,
  args: string[]
): Promise<{ status: 'ok' } | { status: 'failed'; output: string } | { status: 'skipped'; reason: string }> =>
  new Promise((resolve) => {
    execFile(command, args, { timeout: LINT_TIMEOUT_MS }, (error, _stdout, stderr) => {
      if ((error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') {
        resolve({ status: 'skipped', reason: `${command} is not available` });
        return;
      }
      if (error && (error as { killed?: boolean }).killed) {
        resolve({ status: 'skipped', reason: `${command} timed out` });
        return;
      }
      if (error) {
        resolve({
          status: 'failed',
          output: (stderr || error.message || '').slice(0, MAX_LINT_OUTPUT_CHARS),
        });
        return;
      }
      resolve({ status: 'ok' });
    });
  });

/**
 * Best-effort syntax gate for edited files: verify what the host can check
 * statically (JSON inline; Python via ast.parse; JS via node --check) and
 * skip every other file type so the gate never blocks edits it cannot
 * evaluate. A missing interpreter counts as "cannot evaluate", not as a
 * failure.
 */
export const checkEditedFileSyntax = async (
  filePath: string,
  content: string
): Promise<SyntaxCheckVerdict> => {
  const ext = path.extname(filePath).toLowerCase();

  if (ext === '.json') {
    try {
      JSON.parse(content);
      return { status: 'ok' };
    } catch (error) {
      return {
        status: 'failed',
        checker: 'JSON.parse',
        output: error instanceof Error ? error.message : 'Invalid JSON',
      };
    }
  }

  if (ext === '.py') {
    const tmpPath = path.join(os.tmpdir(), `iki-lint-${randomUUID()}.py`);
    await fs.writeFile(tmpPath, content, 'utf8');
    try {
      const verdict = await runChecker('python3', [
        '-c',
        'import ast,sys; ast.parse(open(sys.argv[1], encoding="utf-8").read(), sys.argv[1])',
        tmpPath,
      ]);
      if (verdict.status === 'failed') return { ...verdict, checker: 'python ast.parse' };
      return verdict;
    } catch {
      return { status: 'skipped', reason: 'could not stage temp file for syntax check' };
    } finally {
      await fs.rm(tmpPath, { force: true });
    }
  }

  if (ext === '.js' || ext === '.mjs' || ext === '.cjs') {
    const tmpPath = path.join(os.tmpdir(), `iki-lint-${randomUUID()}${ext}`);
    await fs.writeFile(tmpPath, content, 'utf8');
    try {
      const verdict = await runChecker('node', ['--check', tmpPath]);
      if (verdict.status === 'failed') return { ...verdict, checker: 'node --check' };
      return verdict;
    } catch {
      return { status: 'skipped', reason: 'could not stage temp file for syntax check' };
    } finally {
      await fs.rm(tmpPath, { force: true });
    }
  }

  return { status: 'skipped', reason: `no syntax checker for ${ext || 'extensionless'} files` };
};
