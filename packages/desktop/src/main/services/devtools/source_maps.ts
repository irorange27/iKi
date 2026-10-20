/**
 * Bundled position → original file. The renderer is bundled by Vite, so a DOM
 * node's position in the built script says nothing useful; the sourcemap that
 * ships next to it is the only honest answer. Pure helpers, no Electron.
 */
import path from 'node:path';

// source-map-js is CJS with no ESM re-export; the type-only import keeps the
// named shape without asking Vite to transform the module's internals.
import type { RawSourceMap } from 'source-map-js';
import sourceMapJs from 'source-map-js';

export type SourceMapInput = {
  /** The script URL DevTools reported for the frame (http or file). */
  scriptUrl: string;
  /** `<scriptUrl>.map` contents, null when the file is missing. */
  mapText: string | null;
  /** 1-based line and column, as CDP reports them. */
  line: number;
  column: number;
};

export type OriginalPosition = {
  source: string;
  line: number;
  column: number;
  name?: string;
};

/** `file:///…`, `/@fs/<abs>` and bare paths all reduce to repo-relative when under `root`. */
export const relativizeSource = (source: string, root: string): string => {
  let candidate = source;
  if (candidate.startsWith('file://')) {
    try {
      candidate = new URL(candidate).pathname;
    } catch {
      // keep the raw value; the prefix check below simply will not match
    }
  }
  // Vite emits `/@fs/<abs>` (dev server) or `../packages/...` (build).
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

/**
 * Resolve one bundled position. `null` means the map exists but has no
 * mapping there — callers must not fall back to the bundled line, which would
 * point into a generated file and be a lie.
 */
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
      // CDP columns are 1-based; source-map expects 0-based.
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
