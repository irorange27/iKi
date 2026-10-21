
import path from 'node:path';

import type { RawSourceMap } from 'source-map-js';
import sourceMapJs from 'source-map-js';

export type SourceMapInput = {
  
  scriptUrl: string;
  
  mapText: string | null;
  
  line: number;
  column: number;
};

export type OriginalPosition = {
  source: string;
  line: number;
  column: number;
  name?: string;
};

export const relativizeSource = (source: string, root: string): string => {
  let candidate = source;
  if (candidate.startsWith('file://')) {
    try {
      candidate = new URL(candidate).pathname;
    } catch {
    }
  }
  const fsMatch = /^\/@fs\/(.*)$/.exec(candidate);
  if (fsMatch) candidate = `/${fsMatch[1]}`;
  if (!candidate.startsWith('/')) return candidate;
  const relative = path.relative(root, candidate);
  return relative.startsWith('..') ? candidate : relative;
};

export const parseSourceMap = (mapText: string): RawSourceMap | null => {
  try {
    const parsed = JSON.parse(mapText) as Partial<RawSourceMap> | null;
    return parsed && Number(parsed.version) === 3 && Array.isArray(parsed.sources)
      ? (parsed as RawSourceMap)
      : null;
  } catch {
    return null;
  }
};

export const mapBundledPosition = (
  input: SourceMapInput,
  root: string
): OriginalPosition | null => {
  if (!input.mapText) return null;
  const raw = parseSourceMap(input.mapText);
  if (!raw) return null;
  // eslint-disable-next-line import/no-named-as-default-member -- the default export is the CJS module object; the named export has no runtime binding under Vite's interop.
  const consumer = new sourceMapJs.SourceMapConsumer(raw);
  try {
    const hit = consumer.originalPositionFor({
      line: Math.max(1, Math.trunc(input.line)),
      column: Math.max(0, Math.trunc(input.column) - 1),
    });
    if (!hit.source || typeof hit.line !== 'number') return null;
    return {
      source: relativizeSource(hit.source, root),
      line: hit.line,
      column: (hit.column ?? 0) + 1,
      ...(hit.name ? { name: hit.name } : {}),
    };
  } finally {
    const destroy = (consumer as { destroy?: () => void }).destroy;
    if (typeof destroy === 'function') destroy.call(consumer);
  }
};
