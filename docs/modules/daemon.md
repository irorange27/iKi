# Daemon

## Purpose
Expose core chat and memory functionality over local HTTP and WebSocket APIs for
multi-client access outside the Electron renderer.

## Responsibilities
- Start HTTP server and WebSocket gateway on localhost.
- Authenticate clients via tokens and client id.
- Enforce scopes and tool allowlists.
- Proxy requests to the main chat service and memory DB.

## Key Files
- `src/daemon/server.ts`: HTTP routes, WebSocket handling, auth, scopes.
- `src/daemon/index.ts`: daemon entry point.
- `docs/brain-daemon-migration.md`: API contract and migration plan.

## Data Flow
1. Client registers using bootstrap token to receive a scoped token.
2. HTTP routes validate token and scopes.
3. Chat requests route to `chatService.send` or `chatService.stream`.
4. Tool approvals resume streams via stored approval sessions.

## Invariants
- Daemon listens on localhost only.
- Default tool allowlist is restricted to low-risk tools.
- Tokens are stored hashed in SQLite.

## Extension Points
- Add additional HTTP routes with scope checks.
- Expand tool allowlist per client.
- Provide non-local access with explicit security controls.

## Failure Modes
- Missing or invalid token returns 401.
- Missing scopes return 403.
- Invalid payloads return 400 with error details.
