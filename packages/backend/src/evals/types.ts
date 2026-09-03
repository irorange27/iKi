/**
 * Eval closed-loop contracts (roadmap item 3): scenarios run against a REAL
 * model and are graded on deterministic task outcomes — file contents and
 * tool usage — never on scripted model behavior or response prose alone.
 */

export type EvalFileExpectation = {
  /** When false, asserts the file was NOT created. Defaults to true. */
  exists?: boolean;
  /** Full-content equality, ignoring trailing whitespace. */
  equals?: string;
  /** Every substring must appear in the file content. */
  contains?: string[];
};

export type EvalExpectation = {
  /** Every substring must appear (case-insensitive) in the final response. */
  responseContains?: string[];
  /** Workspace files checked after the run (path is workspace-relative). */
  files?: Record<string, EvalFileExpectation>;
  /** Tool names that must have executed at least once. */
  toolsUsed?: string[];
};

export type EvalScenario = {
  id: string;
  /** The user ask, verbatim. */
  prompt: string;
  /** Seed files written into the scenario workspace before the run. */
  files?: Record<string, string>;
  /** Tools the agent may use (registry tool names). */
  tools: string[];
  maxIterations?: number;
  expect: EvalExpectation;
};

export type ScenarioGrade = {
  passed: boolean;
  failures: string[];
};

export type ScenarioOutcome = ScenarioGrade & {
  scenarioId: string;
  response: string;
  toolsUsed: string[];
  iterations: number;
  durationMs: number;
};

export type LiveEvalReport = {
  ranAt: string;
  providerType: string;
  model: string;
  scenarios: ScenarioOutcome[];
  passed: number;
  total: number;
};
