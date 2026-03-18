# Core Agent

## Purpose
Provide a single, validated interface for LLM-backed agents, with tool integration,
message normalization, lifecycle hooks, and deterministic configuration handling.

## Responsibilities
- Validate and normalize agent configuration via Zod.
- Maintain agent state (messages, iteration count, history).
- Build LLM-ready message payloads, including tool results and approvals.
- Register and execute tools through a shared registry.
- Run lifecycle hooks before and after generation.

## Key Files
- `src/core/agent/base.ts`: BaseAgent implementation (config loading, tool execution, hooks).
- `src/core/iki_simple_agent.ts`: SimpleAgent LLM implementation (generate + stream).
- `src/core/agent/types.ts`: Schemas, config, tool, and hook types.
- `src/core/agent/agent.ts`: Factory helpers and defaults.

## Data Flow
1. Load config from AppConfig, merge overrides, validate.
2. Build system prompt and message list.
3. Build tool definitions (Zod schema preferred; JSON schema fallback).
4. Run `generate` or `stream` through AI SDK.
5. Normalize tool approvals and tool results into agent state.

## Invariants
- Config is always validated by Zod before use.
- Tool calls are only executed if registered in the ToolRegistry.
- Tool arguments are validated by tool param schema when present.
- Message roles are normalized and tool results are JSON-encoded.

## Extension Points
- Subclass BaseAgent to change prompt construction or tool execution.
- Register lifecycle hooks via `registerHook`.
- Inject additional tools by registering with ToolRegistry.

## Failure Modes
- Missing provider or model triggers validation errors.
- Tool execution failures are wrapped and surfaced with context.
- Tool schema mismatch results in validation errors before execution.

## Testing
Covered indirectly by tool loop and provider tests; agent-specific behavior is exercised
through main chat tests and tool selection tests.
