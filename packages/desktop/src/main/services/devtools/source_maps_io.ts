import fs from 'node:fs/promises';

/**
 * Fetch the sourcemap that belongs to a renderer script. The Vite dev server
 * keeps `main_window.js` and `main_window.js.map` side by side; the packaged
 * build writes the same pair under `.vite/renderer/main_window/` and loads it
 * over `file://`, so both cases are a single suffix append.
 *
 * Returns null for anything it cannot read — the caller then falls back to the
 * component file rather than pointing at a wrong line.
 */
export const readSourceMap = async (scriptUrl: string): Promise<string | null> => {
  const clean = scriptUrl.replace(/[?#].*$/, '');
  if (!clean) return null;
  if (/^https?:/i.test(clean)) {
    try {
      const response = await fetch(`${clean}.map`);
      return response.ok ? await response.text() : null;
    } catch {
      return null;
    }
  }
  if (!/^(file:|\/)/i.test(clean)) return null;
  const filePath = clean.startsWith('file://') ? new URL(clean).pathname : clean;
  try {
    return await fs.readFile(`${filePath}.map`, 'utf8');
  } catch {
    return null;
  }
};
