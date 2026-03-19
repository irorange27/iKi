# MCP Support Plan

## Context

iKi currently exposes a fixed set of local tools (filesystem, shell, web, fetch) via a global
tool registry. Tools are registered at startup in the main process or daemon and surfaced to
the UI through IPC. There is no dynamic tool source and no support for the Model Context
Protocol (MCP). The database already has placeholder fields related to MCP on providers, but
they are unused.

MCP support should let users connect to external tool servers (local or remote), expose their
tools in a safe, structured way, and keep approvals, auditing, and UI consistent with the
current tool pipeline. The solution must be robust enough to support the upcoming daemon
architecture without duplicating connection state or compromising security.

## Goals

- Allow users to configure and connect to multiple MCP servers.
- Expose MCP tools in the existing tool registry and UI with stable names and metadata.
- Execute MCP tools with proper timeouts, cancellation, and error reporting.
- Preserve current approval flow, with safe defaults for unknown tools.
- Keep a single source of truth for MCP connections in the active brain process
  (Electron main or daemon).
- Provide a path to support MCP resources and prompts after tool support is stable.

## Non-goals

- No auto-enablement of MCP tools in auto tool mode by default.
- No automatic discovery of MCP servers on the network in v1.
- No cloud hosting or multi-tenant MCP routing in v1.
- No speculative support for MCP extensions without a concrete spec.

## Requirements

### Functional

1. Persist MCP server configurations (local process, streamable HTTP, or SSE URL).
2. Connect to servers and list available tools.
3. Generate tool definitions from MCP schemas and register them.
4. Execute MCP tool calls through the same tool pipeline used by built-in tools.
5. Allow per-server enable/disable and per-tool allowlist.
6. Maintain tool approvals and surface them in the UI.
7. Support daemon clients with allowlists that include MCP tools when explicitly enabled.

### Non-functional

1. Stable tool naming and collision avoidance.
2. Safe default approvals for unknown or risky tools.
3. Clear failure modes and reconnect behavior.
4. Secret handling that does not leak tokens into logs or UI.
5. Minimal startup overhead when MCP is disabled.

## Architecture Overview

### Core MCP Manager

Introduce a core module (for example `src/core/mcp`) that owns MCP lifecycle and acts as the
single integration point for both Electron main and the daemon. Responsibilities:

1. Load server definitions from storage.
2. Connect and monitor health of each server.
3. Cache tool metadata and expose a normalized tool catalog.
4. Provide a `callTool` method used by tool handlers.
5. Emit events when tool catalogs change so UI and registries can refresh.

This module should not know about UI or IPC. It should expose an interface that can be used
by main process IPC handlers and by the daemon server.

### Tool Registry Integration

MCP tools are dynamic, so the tool registry must support incremental updates. Add support for:

1. Registering a batch of tools by source (built-in vs MCP server).
2. Removing or replacing tools for a given MCP server when it disconnects or is disabled.
3. Returning tool metadata that includes the source server id, display name, and output schema.

Use MCP JSON Schema definitions directly as `parameters`, and pass MCP `outputSchema`
through to AI SDK `tool()` definitions so typed tool outputs remain available.
If an MCP schema is invalid or too large, fall back to a minimal `{ type: "object" }` schema
and surface a warning in logs.

### Tool Naming and Metadata

Avoid name collisions by namespacing MCP tools. Proposed scheme:

- Internal name: `mcp_<hash>_<toolSlug>` (provider-safe, mapped to serverId/toolName internally)
- Display name: use the MCP tool title (or tool name) in the UI

Store both the internal name and human-readable labels so UI can group tools by server while
the LLM sees a stable, deterministic identifier. Chat UI should include the server label when
rendering tool output to avoid ambiguity.

### System Prompt and Tool Catalog

The model already receives tool definitions, but the tool system prompt should be updated to:

1. Emphasize that MCP tools may call external services.
2. Require minimal data disclosure and explicit justification for each call.
3. Encourage using built-in tools first when they are safer or simpler.

This keeps tool usage aligned with safety expectations without relying on tool descriptions
alone.

### Approval Policy

Default policy should be conservative:

- All MCP tools require approval unless explicitly marked safe.
- If MCP provides safety annotations (read-only, safe, destructive), map them to
  `needsApproval` decisions.
- Add a per-server approval mode: `always`, `safe-only`, `never`.

Unknown or missing annotations should be treated as risky.

### Connection and Execution Flow

1. User enables an MCP server in Settings.
2. MCP Manager connects and fetches tool catalog.
3. Manager registers tools in the registry with stable hashed internal names plus MCP source metadata.
4. ToolSelector loads updated metadata through IPC and shows the tools.
5. Chat request includes selected tool names plus the enabled MCP server ids for that conversation.
6. Tool handler delegates to MCP Manager `callTool` with timeout and retries.
7. Results are returned via the existing tool result stream.
8. If an MCP tool declares `outputSchema`, prefer `structuredContent`; otherwise parse JSON text
   output and fail fast if the server only returns unstructured text.

### Lifecycle and Resilience

1. `connectOnStartup` is optional and gated by `mcp.enabled`.
2. Use exponential backoff for reconnects and record last error in the DB.
3. Cache the last known tool catalog and mark tools as unavailable when offline.
4. For stdio servers, manage the child process lifecycle and cleanly terminate on shutdown.
5. Ensure a single active connection per server to avoid duplicated tool registrations.
6. Follow AI SDK MCP guidance for remote transports: prefer Streamable HTTP, keep SSE for
   compatibility, and reject HTTP redirects.

### Resource and Prompt Support (Phase 2)

MCP resources and prompts are useful but distinct from tools. Plan to support them after tool
support stabilizes by:

1. Exposing resources through a generic `mcp_resource` tool or a dedicated UI panel.
2. Converting MCP prompts into optional skill-like templates.

## Data Model

### New Tables

1. `mcp_servers`
   - `id` (PK)
   - `name`
   - `transport` (`stdio`, `streamable-http`, `sse`)
   - `command` / `args` / `cwd` (for stdio)
   - `base_url` / `headers` / `auth_ref` (for remote)
   - `enabled`
   - `tool_allowlist` (JSON array of tool names or null = all)
   - `approval_mode` (enum string)
   - `created_at`, `updated_at`, `last_connected_at`, `last_error`

2. `provider_mcp_servers` (optional, if servers are tied to providers)
   - `provider_id`
   - `server_id`

### Config Extensions

Add an `mcp` section to `AppConfig`:

- `enabled` (global feature flag)
- `connectOnStartup`
- `allowRemoteServers` (default false)
- `defaultApprovalMode`
- `requestTimeoutMs`
- `maxConcurrentRequests`

### Migration Strategy

If `providers.acp_mcp_server_ids` has existing data, migrate it into
`provider_mcp_servers`. Otherwise keep it unused but documented as deprecated.

## IPC and Daemon API

### Electron IPC

Add IPC endpoints for MCP management:

- `mcp:list`
- `mcp:add`
- `mcp:update`
- `mcp:delete`
- `mcp:connect`
- `mcp:disconnect`
- `mcp:refresh-tools`

Tool list IPC should include MCP tools with `source` metadata so the UI can group them.

### Daemon Server

Expose similar endpoints under `/v1/mcp/*` and ensure MCP tools are available only if the
client allowlist explicitly includes them. Keep default allowed tools unchanged.

## UI and UX

### Settings

Add a Settings panel for MCP with:

- Server list with status (connected, error, disabled).
- Add/Edit server modal with transport-specific fields.
- Clear transport guidance: Streamable HTTP first, SSE only for legacy servers.
- Toggle to enable remote servers with warnings.
- Per-server approval mode and tool allowlist.
- Test connection button with clear error output.

### Tool Selector

Group tools by source:

- Built-in tools
- MCP: <server name>

Provide search and bulk select per server to avoid overwhelming the user when many tools are
available.

### Tool Output

For unknown tool schemas, render JSON payloads with a generic viewer and preserve raw output.
Do not discard fields that do not match built-in schemas.

## Security and Safety

1. Require explicit user action to add or enable a server.
2. Default to local-only servers; remote servers require a dedicated opt-in.
3. Redact auth tokens and secrets in logs and UI.
4. Store secrets in OS keychain when available; otherwise encrypt at rest when
   `security.encryptApikeys` is enabled.
5. Enforce timeouts and max payload sizes to prevent hangs or memory abuse.

## Observability

Add structured logs for:

- MCP connect/disconnect and health checks.
- Tool execution latency and errors.
- Tool catalog refresh events.

Make sure logs omit user secrets and large payloads.

## Testing Plan

1. Unit tests for MCP Manager connection lifecycle and tool catalog parsing.
2. Tests for tool registration/unregistration and metadata propagation to the UI.
3. Approval policy tests covering safe, unsafe, and unknown tools.
4. Integration test using a local MCP mock server (stdio) to validate tool execution.
5. Daemon API tests for MCP endpoints and allowlist enforcement.

## Phased Delivery

1. Phase 1: Core MCP Manager, data model, IPC, and tool registry integration.
2. Phase 2: Settings UI, ToolSelector grouping, and approval policy tuning.
3. Phase 3: Resource/prompt support and richer UI rendering.
4. Phase 4: Optional auto-tool routing for safe MCP tools from explicitly enabled servers.

## Open Questions

1. How much SSE support should remain once the server ecosystem largely moves to Streamable HTTP?
2. What is the canonical safety annotation in the MCP spec, and how should it map to
   `needsApproval`?
3. Should MCP servers be tied to providers, or be global for all providers?
4. Should tool allowlists be per-thread or global per server?
