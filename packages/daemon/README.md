# @iki/daemon

Headless HTTP + WebSocket server. Exposes the same chat/agent surface as the desktop app to external clients (NapCat QQ bridge being the primary one).

## Entry

`src/index.ts` is the package entry; the binary is started by the desktop app with `--daemon`, or via `pnpm run daemon:start`. Binds to `127.0.0.1` by default.

## Surface

| Path | What |
|---|---|
| `server_http.ts` | REST: `/v1/chat/send`, `/v1/chat/approve-tool`, `/v1/chat/stop-stream`, threads, messages, runs |
| `server_ws.ts` | WS `/v1/chat/stream` — message types: `start`, `approve-tool`, `steer`, `stop`. Adapts each WS session to a `ChatStreamTarget` (`{ id, send }`) so it can reuse `thread_session.stream` unchanged. |
| `napcat_adapter.ts` | OneBot v11 reverse WS endpoint `/onebot/v11/ws` (QQ bot bridge). Calls `thread_session.send` (non-streaming). |
| `tool_access.ts` | Per-client tool filtering |

## Don't

- Don't duplicate chat logic. The daemon **must** reuse `@iki/backend` — including the streaming path, by adapting each connection to a `ChatStreamTarget` for `chatService.stream`.
- Don't expose the daemon to `0.0.0.0` without an auth story.

See repo root [AGENTS.md](../../AGENTS.md) and [docs/napcat-integration.md](../../docs/napcat-integration.md).
