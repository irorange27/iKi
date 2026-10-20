// @vitest-environment node

import { describe, expect, it } from 'vitest';

import { auditRenderer } from '../../scripts/a11y_audit.mjs';

// Pins the accessibility floor of the renderer templates.
//
// The audit started at 81 real defects (unnamed controls, click handlers with no
// keyboard parity, ARIA state that no longer matched the widget). This test makes
// that a ratchet: a new unlabelled control or a new clickable div fails here
// instead of shipping. When a finding is genuinely correct-by-design, teach the
// auditor about it (see `data-a11y-delegated-click`) rather than adding an
// exception list, so the reason stays visible at the call site.
describe('renderer a11y audit', () => {
  it('reports no accessibility errors in any template', () => {
    const { files, findings } = auditRenderer();
    const errors = findings.filter(finding => finding.level === 'error');

    // The audit has to actually see the renderer, or a green run means nothing.
    expect(files.length).toBeGreaterThan(40);

    expect(
      errors.map(error => `${error.file}:${error.line} [${error.rule}] ${error.message}`)
    ).toEqual([]);
  });

  it('reports no weak-title warnings', () => {
    const { findings } = auditRenderer();
    // A title-only name never appears on keyboard focus, so it is not a name.
    const titleOnly = findings.filter(finding => finding.rule === 'title-only-name');
    expect(titleOnly.map(warning => `${warning.file}:${warning.line}`)).toEqual([]);
  });
});
