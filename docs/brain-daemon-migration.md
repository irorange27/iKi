# iKi Brain Daemon v0.1 Migration (HTTP + WebSocket)

This document captures the agreed migration plan to move iKi's "brain" into a
local, standalone daemon that can be shared by multiple applications.

## Background
Today, the brain lives inside the Electron main process. The renderer calls it
via IPC. This limits reuse by other applications. The goal is to extract the
core logic into a local daemon and expose a stable local API.

## Goals
- Multiple apps share one local brain and memory.
- Minimal disruption to existing core logic.
- UI remains compatible by reusing the current streaming chunk format.
- Local-only access by default.

## Non-goals
- No cloud service in v0.1.
- No public network exposure in v0.1.
- No enterprise-grade IAM in v0.1.

## Architecture Overview
- Brain Daemon: local process, owns core logic + database.
- Clients: Electron UI, IDE plugins, browser extensions, etc.
- Transport: HTTP for request/response, WebSocket for streaming.

## Connection and Discovery
- Base URL: http://127.0.0.1:6127/v1
- Auth: Authorization: Bearer <token>
- Client ID: X-Iki-Client: <client_id>
- Discovery files:
  - ~/.iki/daemon.port
  - ~/.iki/daemon.token (bootstrap token for client registration)

## API v0.1

### HTTP Endpoints
- GET /health
- POST /clients/register
- GET /chat/threads
- GET /chat/threads/{id}
- POST /chat/threads
- GET /chat/messages?thread_id=...
- POST /chat/send
- POST /chat/approve-tool
- POST /chat/stop-stream
- GET /memory/short?thread_id=...
- GET /memory/long?thread_id=...
- POST /memory/search

### POST /clients/register
Requires header: X-Iki-Setup-Token: <bootstrap token>

Request:
```json
{
  "name": "iKi Desktop",
  "scopes": ["chat:read","chat:write","memory:read","memory:write","tools:run","tools:approve"],
  "allowed_tools": ["web","fetch","list_dir"]
}
```

Response:
```json
{
  "success": true,
  "client_id": "client_7h2k3",
  "token": "iki_local_xxx",
  "scopes": ["chat:read","chat:write","memory:read","memory:write","tools:run","tools:approve"],
  "allowed_tools": ["web","fetch","list_dir"]
}
```

### POST /chat/send
Request:
```json
{
  "thread_id": "thread_abc",
  "providerType": "openai",
  "model": "gpt-4.1-mini",
  "messages": [
    { "role": "user", "content": "Summarize this text..." }
  ],
  "tools": ["web","fetch"],
  "skillIds": [],
  "skillMode": "auto",
  "context": {
    "app_name": "Notes",
    "window_title": "Meeting.txt",
    "selection": "..."
  }
}
```

Response:
```json
{
  "success": true,
  "text": "Summary: ..."
}
```

### POST /chat/approve-tool
Request:
```json
{
  "approval_id": "approval_9k3f2",
  "approved": true,
  "reason": "user approved",
  "connection_id": 3
}
```

Response:
```json
{ "success": true, "awaitingApproval": false }
```

### POST /chat/stop-stream
Requires header: X-Iki-Connection: <connection_id>

Response:
```json
{ "success": true }
```

### POST /memory/search
Request:
```json
{
  "query": "budget from last meeting",
  "limit": 5,
  "threshold": 0.25
}
```

Response:
```json
{
  "success": true,
  "results": [
    { "id": "meml_x1", "summary": "...", "score": 0.31, "updated_at": "..." }
  ]
}
```

## WebSocket (Streaming)
- WS ws://127.0.0.1:6127/v1/chat/stream
- If headers are not available, use query params: ?token=<token>&client_id=<client_id>

Client start message:
```json
{
  "type": "start",
  "request_id": "req_123",
  "payload": {
    "thread_id": "thread_abc",
    "providerType": "openai",
    "model": "gpt-4.1-mini",
    "messages": [
      { "role": "user", "content": "Organize into bullet points" }
    ],
    "tools": ["web","fetch"],
    "skillMode": "auto"
  }
}
```

Server events (reuse existing UI chunk types):
- start, text-start, text-delta, text-end, finish, abort, error
- tool-input-start, tool-input-delta, tool-input-available, tool-input-error
- tool-output-available, tool-output-error, tool-output-denied
- tool-approval-request
- memory-retrieval

Example event stream:
```json
{ "type": "start", "messageId": "assistant_abc" }
{ "type": "text-start", "id": "assistant_abc" }
{ "type": "text-delta", "id": "assistant_abc", "delta": "Okay, " }
{ "type": "tool-approval-request", "approvalId": "approval_9k3f2", "toolCallId": "tool_call_1" }
{ "type": "finish" }
```

Note:
- WebSocket connections receive a daemon "ready" envelope containing connection_id.
- Approvals are recommended via WebSocket using type "approve-tool" or via HTTP with connection_id.

## Tool Policy
- If tools is omitted: auto mode. Only low-risk tools (web, fetch) are eligible, and a router
  picks the minimal subset for the request.
- tools: [] explicitly disables tools.
- tools: ["read_file","shell"] is manual mode.
- Effective tools = requested tools (or auto-selected safe tools) intersect client.allowed_tools.
- Approval still follows each tool's needsApproval rule.

## Data Model Changes (Minimal)
- New table: app_clients
  - id, name, token_hash, scopes, allowed_tools, created_at, updated_at, last_seen
- chat_threads: add client_id
  - used to scope thread access and memory search
- Optional: client_workspaces
  - restrict file tools per client

## Electron UI Migration (Minimal)
- Keep window.electronAPI surface but implement it via HTTP/WS client calls.
- chat.onUiChunk listens to WS chunk events.
- Existing UI parsing can remain unchanged.

## Migration Steps
1. Extract Brain Core so it does not depend on Electron APIs.
2. Add daemon entrypoint and start HTTP/WS server.
3. Map current IPC handlers to HTTP/WS routes.
4. Switch Electron UI to HTTP/WS client.
5. Add client registration + scopes + tool allowlists.
6. Add auto-start and health checks.

## Acceptance Criteria
- Multiple clients can access the same brain and memory.
- WebSocket streaming and tool approvals work end-to-end.
- Electron UI works without IPC.
- Daemon listens on 6127 and passes health check.

## Risks and Mitigations
- Port conflicts: detect on startup and fail fast with guidance.
- Over-permissive tools: default allowlist remains low-risk.
- Approval deadlocks: use timeout and recovery strategy.
- UI regressions: keep chunk format unchanged.
