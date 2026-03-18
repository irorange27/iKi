# Core Tools

## Purpose
Provide a validated, auditable tool system that bridges the AI SDK and local
capabilities (filesystem, shell, and network).

## Responsibilities
- Define tool contracts (name, description, input schema, approval policy).
- Provide ToolRegistry for registration and lookup.
- Implement standard tools (file, shell, web, fetch).
- Enforce safety policies (workspace path boundaries, high-risk shell checks).

## Key Files
- `src/core/tools/base.ts`: BaseTool, ToolRegistry, schema conversion helpers.
- `src/core/tools/schemas.ts`: Zod schemas and constants for tool IO.
- `src/core/tools/file_tools.ts`: read/write/list/delete tools with workspace bounds.
- `src/core/tools/shell_tools.ts`: shell tool with risk detection and approval policy.
- `src/core/tools/web_tools.ts`: web search and fetch (HTML to text) tools.
- `src/core/tools/index.ts`: standard tool registration.

## Data Flow
1. Tool is registered in ToolRegistry (global or per-agent).
2. Agent builds AI SDK tool definitions from Zod input schemas.
3. Tool calls are validated, then executed.
4. Tool results are serialized and injected into conversation.

## Invariants
- File tools only operate inside visible workspace roots or the current cwd.
- Shell tool approval follows configured policy and high-risk regex checks.
- Web search uses DuckDuckGo HTML with Bing RSS fallback.

## Extension Points
- Implement BaseTool to add new tools with validated parameters.
- Register tools globally via `registerStandardTools`.
- Provide custom approval policies via `needsApproval`.

## Failure Modes
- Invalid Zod schema conversion falls back to safe JSON schema.
- Shell execution errors return structured `isError` payload.
- Fetch rejects non-HTTP(S) and non-text content types.

## Testing
- `tests/core/tools/web_tools.test.ts` covers search parsing and fallback behavior.
