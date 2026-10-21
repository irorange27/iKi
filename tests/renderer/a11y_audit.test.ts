// @vitest-environment node

import { describe, expect, it } from 'vitest';

import { auditRenderer } from '../../scripts/a11y_audit.mjs';

describe('renderer a11y audit', () => {
  it('reports no accessibility errors in any template', () => {
    const { files, findings } = auditRenderer();
    const errors = findings.filter(finding => finding.level === 'error');

    expect(files.length).toBeGreaterThan(40);

    expect(
      errors.map(error => `${error.file}:${error.line} [${error.rule}] ${error.message}`)
    ).toEqual([]);
  });

  it('reports no weak-title warnings', () => {
    const { findings } = auditRenderer();
    const titleOnly = findings.filter(finding => finding.rule === 'title-only-name');
    expect(titleOnly.map(warning => `${warning.file}:${warning.line}`)).toEqual([]);
  });
});
