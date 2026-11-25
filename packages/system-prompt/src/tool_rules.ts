export const NO_TOOLS_SYSTEM_PROMPT = [
  'No tools are enabled for this turn.',
  'Do not claim to inspect local files, shell state, web pages, or external systems.',
  'If live verification or local access is required, state that directly instead of guessing.',
].join('\n');

export const buildToolSystemPrompt = (params: {
  enableTools: boolean;
  enabledToolNames?: readonly string[];
  platform?: NodeJS.Platform;
}): string => {
  if (!params.enableTools) {
    return NO_TOOLS_SYSTEM_PROMPT;
  }

  const tools = new Set(params.enabledToolNames ?? []);
  const hasAny = (...names: string[]) => names.some(name => tools.has(name));
  const platform = params.platform ?? process.platform;

  const rules: string[] = [
    'Answer directly when tools are unnecessary; otherwise use the minimal tool calls needed to verify live facts.',
    'Report only file paths, symbols, command outputs, and test results directly observed in tool outputs; never invent unverified results.',
    'Do not paste raw tool output verbatim when the transcript already shows it; state clear conclusions and key values.',
  ];

  if (hasAny('read_file', 'edit', 'write_file', 'delete_file')) {
    rules.push(
      'Read files before editing them, prefer targeted edits over full rewrites, and keep file actions scoped to the active workspace when one is set.'
    );
  }

  if (tools.has('bash')) {
    rules.push(
      'Use `bash` for workspace file inspection, edits, git, and builds; stay conservative with destructive commands.'
    );
  } else if (tools.has('pwsh')) {
    rules.push(
      'Use `pwsh` (PowerShell 7) for workspace file inspection, edits, git, and builds; stay conservative with destructive commands.'
    );
  } else if (tools.has('shell')) {
    rules.push(
      platform === 'win32'
        ? 'Use `shell` (PowerShell 7 / pwsh) for workspace file inspection, edits, git, and builds; stay conservative with destructive commands.'
        : 'Use `shell` (bash) for workspace file inspection, edits, git, and builds; stay conservative with destructive commands.'
    );
  }

  if (tools.has('job')) {
    rules.push(
      'Long-running commands can run with `background: true` or auto-promote on timeout; use `job` (`list`, `output`, `wait`, `kill`) to inspect or stop durable background jobs.'
    );
  }

  if (tools.has('ptc')) {
    rules.push(
      'Use `ptc` (Programmatic Tool Calling) to run a short TypeScript/JavaScript snippet when chaining, looping, or running multiple tool/MCP calls in parallel (`Promise.all`) and filtering/aggregating results before replying. In MCP Code Mode, inspect signatures via `mcp.describe(server?)` and call MCP APIs via `await mcp.<server>.<tool>(args)`.'
    );
  }

  if (tools.has('web') || tools.has('fetch')) {
    rules.push(
      tools.has('web') && tools.has('fetch')
        ? '`web` only returns candidate URLs; use `fetch` to read page contents before making specific claims.'
        : 'Verify external web information with the available web tool instead of relying on memory for live data.'
    );
  }

  if (tools.has('agent')) {
    rules.push(
      'Use `agent` only for bounded, independent side investigations; handle direct 1-2 step file or shell actions yourself.'
    );
  }

  if (tools.has('plan')) {
    rules.push('Use `plan` only for substantial multi-step tasks; skip it for simple questions or single edits.');
  }

  if ([...tools].some(name => name.startsWith('mcp_'))) {
    rules.push('Minimize data shared with external MCP servers and avoid sending secrets.');
  }

  return ['<rules>', ...rules.map(rule => `- ${rule}`), '</rules>'].join('\n');
};
