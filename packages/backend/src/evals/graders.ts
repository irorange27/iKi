import type { EvalExpectation, ScenarioGrade } from './types';

/**
 * Deterministic graders: score task outcomes (files on disk, tool usage,
 * response substrings), not response prose style. Deterministic on purpose —
 * the same outcome must always grade the same way across harness changes.
 */
export const gradeScenarioOutcome = (params: {
  expect: EvalExpectation;
  response: string;
  /** path -> final content; a missing key means the file does not exist. */
  files: Record<string, string>;
  toolsUsed: string[];
}): ScenarioGrade => {
  const failures: string[] = [];
  const expect = params.expect;
  const responseLower = params.response.toLowerCase();

  for (const needle of expect.responseContains ?? []) {
    if (!responseLower.includes(needle.toLowerCase())) {
      failures.push(`response missing: "${needle}"`);
    }
  }

  for (const [filePath, expectation] of Object.entries(expect.files ?? {})) {
    const content = params.files[filePath];
    if (content === undefined) {
      if (expectation.exists === false) continue;
      failures.push(`file missing: ${filePath}`);
      continue;
    }
    if (
      expectation.equals !== undefined &&
      content.replace(/\s+$/, '') !== expectation.equals.replace(/\s+$/, '')
    ) {
      failures.push(`file ${filePath}: content mismatch`);
    }
    for (const needle of expectation.contains ?? []) {
      if (!content.includes(needle)) {
        failures.push(`file ${filePath} missing: "${needle}"`);
      }
    }
  }

  for (const tool of expect.toolsUsed ?? []) {
    if (!params.toolsUsed.includes(tool)) {
      failures.push(`tool not used: ${tool}`);
    }
  }

  return { passed: failures.length === 0, failures };
};
