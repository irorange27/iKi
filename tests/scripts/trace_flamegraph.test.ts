import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

const tempDirs: string[] = [];

describe('trace_flamegraph', () => {
  afterEach(async () => {
    await Promise.allSettled(tempDirs.map(dir => rm(dir, { recursive: true, force: true })));
    tempDirs.length = 0;
  });

  it('writes matching html and trace artifacts', async () => {
    const module = await import('../../scripts/benchmarks/trace_flamegraph.cjs');
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'iki-trace-flamegraph-'));
    tempDirs.push(tempDir);

    const result = await module.writeTraceArtifacts({
      outputDir: tempDir,
      basename: 'sample',
      title: 'Sample Flamegraph',
      totalDurationMs: 100,
      spans: [
        {
          track: 'Run',
          label: 'benchmark',
          startMs: 0,
          durationMs: 100,
          category: 'run',
        },
      ],
      markers: [
        {
          track: 'Run',
          label: 'done',
          atMs: 100,
          category: 'event',
        },
      ],
      metadata: {
        benchmark: 'sample',
      },
    });

    const html = await readFile(result.flamegraphHtmlPath, 'utf8');
    const trace = await readFile(result.traceJsonPath, 'utf8');

    expect(html).toContain('Sample Flamegraph');
    expect(html).toContain('benchmark');
    expect(trace).toContain('"traceEvents"');
    expect(trace).toContain('"thread_name"');
  });
});
