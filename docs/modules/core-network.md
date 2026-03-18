# Core Network

## Purpose
Provide a single, configurable HTTP layer with timeouts, retries, and proxy support.

## Responsibilities
- Read network config from AppConfig.
- Apply HTTP/HTTPS proxy settings to process environment.
- Enforce request timeouts and limited retries.

## Key Files
- `src/core/network/http.ts`: `fetchWithTimeout` and network config accessors.

## Data Flow
1. Read network settings (timeout, retryAttempts, proxy).
2. Apply proxy env vars before making requests.
3. Use abort controller for request timeouts.
4. Retry on transient status codes.

## Invariants
- Timeout is clamped between 1s and 60s.
- Retries are clamped between 0 and 10.
- Proxy is only applied when fully configured.

## Extension Points
- Add custom retry policies or backoff strategies.
- Add request-level overrides.

## Failure Modes
- Timeout aborts return a normalized timeout error.
- Non-retryable status codes return immediately.
