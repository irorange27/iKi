/**
 * Per-turn context-assembly switches.
 *
 * `contextMode` is a context-budget concern (benchmark clean runs assemble no
 * identity/skill blocks so an eval sees only the raw transcript) and is
 * unrelated to the removed affect/emotion subsystem.
 */
export type ChatContextMode = 'default' | 'benchmark_clean';

export type ChatExperimentalContext = {
  contextMode?: ChatContextMode;
};
