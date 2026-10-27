import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

// Source-scan, not import: the preload/main pair is electron-coupled, and the
// contract under test is the literal channel strings on both sides.
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

const readRepoFile = (relativePath: string): string =>
  readFileSync(join(repoRoot, relativePath), 'utf8');

const walkTsFiles = (relativeDir: string): string[] => {
  const absolute = join(repoRoot, relativeDir);
  return readdirSync(absolute, { withFileTypes: true }).flatMap(entry => {
    const entryPath = join(relativeDir, entry.name);
    if (entry.isDirectory()) return walkTsFiles(entryPath);
    return entry.name.endsWith('.ts') ? [entryPath] : [];
  });
};

const literals = (sources: string, pattern: RegExp): string[] =>
  [...sources.matchAll(pattern)].map(match => match[1]);

const preloadSource = readRepoFile('packages/desktop/src/preload/index.ts');
const mainSources = [
  readRepoFile('packages/desktop/src/main.ts'),
  ...walkTsFiles('packages/desktop/src/main').map(readRepoFile),
].join('\n');
const backendStreamSources = walkTsFiles('packages/backend/src/thread_session')
  .map(readRepoFile)
  .join('\n');

const invokeChannels = new Set(literals(preloadSource, /ipcRenderer\.invoke\(\s*'([^']+)'/g));
const sendChannels = new Set(literals(preloadSource, /ipcRenderer\.send\(\s*'([^']+)'/g));
const subscribeChannels = new Set(literals(preloadSource, /subscribe\(\s*'([^']+)'/g));

const handleChannels = new Set(literals(mainSources, /ipcMain\.handle\(\s*'([^']+)'/g));
const onChannels = new Set(literals(mainSources, /ipcMain\.on\(\s*'([^']+)'/g));

const channelConstants = new Map<string, string>();
for (const match of mainSources.matchAll(/const ([A-Z][A-Z0-9_]*) = '([^']+)'/g)) {
  channelConstants.set(match[1], match[2]);
}

const pushChannels = new Set<string>();
for (const match of mainSources.matchAll(
  /(?:webContents|sender)\.send\(\s*('([^']+)'|[A-Z][A-Z0-9_]*)/g
)) {
  const channel = match[1].startsWith("'") ? match[2] : channelConstants.get(match[1]);
  if (channel) pushChannels.add(channel);
}
// broadcastToRenderers funnels window pushes through one helper; its channel
// is a literal or an UPPER_SNAKE constant at the call site.
for (const match of mainSources.matchAll(
  /broadcastToRenderers\(\s*('([^']+)'|[A-Z][A-Z0-9_]*)/g
)) {
  const channel = match[1].startsWith("'") ? match[2] : channelConstants.get(match[1]);
  if (channel) pushChannels.add(channel);
}

// Streaming chunks and run-status updates cross the boundary through an
// injected target supplied by the shell, so their producers live in backend.
const backendPushChannels = new Set(literals(backendStreamSources, /\.send\(\s*'([^']+)'/g));

describe('IPC channel registry', () => {
  it('still finds the known channel population', () => {
    expect(invokeChannels.size).toBeGreaterThan(60);
    expect(sendChannels.size).toBeGreaterThan(3);
    expect(subscribeChannels.size).toBeGreaterThan(5);
  });

  it('has a main handler for every channel the preload invokes', () => {
    const missing = [...invokeChannels].filter(channel => !handleChannels.has(channel));
    expect(missing).toEqual([]);
  });

  it('has no orphan handler the preload never invokes', () => {
    const orphans = [...handleChannels].filter(channel => !invokeChannels.has(channel));
    expect(orphans).toEqual([]);
  });

  it('has an ipcMain.on listener for every channel the preload sends', () => {
    const missing = [...sendChannels].filter(channel => !onChannels.has(channel));
    expect(missing).toEqual([]);
  });

  it('pushes only to channels the renderer subscribes to', () => {
    const dead = [...pushChannels].filter(channel => !subscribeChannels.has(channel));
    expect(dead).toEqual([]);
  });

  it('has a producer for every renderer subscription', () => {
    const producers = new Set([...pushChannels, ...backendPushChannels]);
    const unsubscribed = [...subscribeChannels].filter(channel => !producers.has(channel));
    expect(unsubscribed).toEqual([]);
  });
});
