# @iki/daemon

Headless HTTP + WebSocket server. Exposes the same chat/agent surface as the desktop app to external clients.

## Entry

`src/index.ts` is the package entry; the desktop app starts it in-process (`startDaemonServer`) when launched with `--iki-daemon`, or standalone via `pnpm run daemon:start`. Binds to `127.0.0.1` by default.

## Surface

| Path | What |
|---|---|
| `server_http.ts` | REST: `/v1/chat/send`, `/v1/chat/approve-tool`, `/v1/chat/stop-stream`, threads, messages, runs (plus trajectory, cancel/retry/resume), `/v1/health`, `/v1/clients/register` (setup-token bootstrap), `/v1/mcp/servers` CRUD + connect/refresh |
| `server_ws.ts` | WS `/v1/chat/stream` — message types: `start`, `approve-tool`, `steer`, `stop`. Adapts each WS session to a `ChatStreamTarget` (`{ id, send }`) so it can reuse `thread_session.stream` unchanged. |
| `tool_access.ts` | Per-client tool filtering: individual MCP tool grants stay individual; `mcp:server:<id>` / `mcp:*` explicitly grant wider access. Server activation filters alone do not authorize tools. |

Awaiters and config have no HTTP surface — they exist only as registered tools (see `tool_access.ts`).

## Don't

- Don't duplicate chat logic. The daemon **must** reuse `@iki/backend` — including the streaming path, by adapting each connection to a `ChatStreamTarget` for `chatService.stream`.
- Don't expose the daemon to `0.0.0.0` without an auth story.

See repo root [AGENTS.md](../../AGENTS.md).
