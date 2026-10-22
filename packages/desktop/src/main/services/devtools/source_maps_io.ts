import fs from 'node:fs/promises';

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
