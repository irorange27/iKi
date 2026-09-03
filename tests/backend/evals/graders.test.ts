import { describe, expect, it } from 'vitest';

import { gradeScenarioOutcome } from '@iki/backend/evals/graders';

describe('gradeScenarioOutcome', () => {
  it('passes a fully satisfied expectation', () => {
    const grade = gradeScenarioOutcome({
      expect: {
        responseContains: ['done'],
        files: { 'a.json': { contains: ['"port": 8080'] } },
        toolsUsed: ['edit'],
      },
      response: 'Done, port updated.',
      files: { 'a.json': '{ "port": 8080 }' },
      toolsUsed: ['edit', 'read_file'],
    });
    expect(grade).toEqual({ passed: true, failures: [] });
  });

  it('collects every failure instead of stopping at the first', () => {
    const grade = gradeScenarioOutcome({
      expect: {
        responseContains: ['done'],
        files: { 'missing.md': { exists: true }, 'a.md': { equals: 'x' } },
        toolsUsed: ['shell'],
      },
      response: 'partially',
      files: { 'a.md': 'y' },
      toolsUsed: [],
    });
    expect(grade.passed).toBe(false);
    expect(grade.failures).toEqual([
      'response missing: "done"',
      'file missing: missing.md',
      'file a.md: content mismatch',
      'tool not used: shell',
    ]);
  });

  it('treats trailing whitespace as insignificant for equals', () => {
    const grade = gradeScenarioOutcome({
      expect: { files: { 'report.md': { equals: 'eval ok' } } },
      response: '',
      files: { 'report.md': 'eval ok\n' },
      toolsUsed: [],
    });
    expect(grade.passed).toBe(true);
  });

  it('honors exists: false for must-not-create files', () => {
    const grade = gradeScenarioOutcome({
      expect: { files: { 'temp.txt': { exists: false } } },
      response: '',
      files: {},
      toolsUsed: [],
    });
    expect(grade.passed).toBe(true);
  });
});
