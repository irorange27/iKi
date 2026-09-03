/**
 * Package boundary rules — see docs/design/architecture-factoring.md (P1) and
 * docs/conventions.md. Enforcement for what ADR-003 left as convention.
 *
 * `pathNot` exemptions are deliberate, shrinking tech debt:
 *   - provider -> tools/{skills,retry,runtime_context}  : removed in P2 (leaf moves)
 *   - tools/agent_tools -> agent_session, provider       : removed in P2 (DI at registration)
 *   - agent_session -> config.ts (getAppConfig)          : removed in P3 (config injection)
 */
module.exports = {
  forbidden: [
    {
      name: 'backend-stays-pure',
      comment: 'Golden rule: packages/backend is pure Node/TS — no Electron/Vue/Vite, no renderer SDKs',
      severity: 'error',
      from: { path: '^packages/backend' },
      to: { path: 'node_modules/(electron|vue|@vitejs/|@vue/|@ai-sdk/vue|@ai-sdk/react|happy-dom)' },
    },
    {
      name: 'no-reverse-dependency',
      comment: 'Dependencies point one way only: shells -> backend, never backend -> shells',
      severity: 'error',
      from: { path: '^packages/backend' },
      to: { path: '^packages/(desktop|daemon)' },
    },
    {
      name: 'provider-is-leaf',
      comment: 'R1: provider/ wires models; it must not reach up into tools/session/orchestration',
      severity: 'error',
      from: { path: '^packages/backend/src/provider' },
      to: {
        path: '^packages/backend/src/(tools|agent_session|chat_service)',
        pathNot: '^packages/backend/src/tools/(skills|retry|runtime_context)\\.ts$',
      },
    },
    {
      name: 'tools-below-session',
      comment: 'R2: concrete tools stay below agent_session/provider/chat_service',
      severity: 'error',
      from: { path: '^packages/backend/src/tools', pathNot: '^packages/backend/src/tools/agent_tools\\.ts$' },
      to: { path: '^packages/backend/src/(agent_session|provider|chat_service)' },
    },
    {
      name: 'agent-below-session-and-orchestration',
      comment: 'R3 (loop+harness only; agent_session -> chat_service shared-module debt is deferred, see factoring doc)',
      severity: 'error',
      from: { path: '^packages/backend/src/agent/' },
      to: { path: '^packages/backend/src/(agent_session|chat_service)' },
    },
    {
      name: 'session-reads-no-global-config',
      comment: 'R4 (ADR-001 follow-up): config is injected into agent_session/agent; config/defaults.ts (pure constants) is fine',
      severity: 'error',
      from: {
        path: '^packages/backend/src/(agent_session|agent)',
        pathNot: '^packages/backend/src/agent_session/(tool_guard|turn_preparer|context_helpers)\\.ts$',
      },
      to: { path: '^packages/backend/src/config\\.ts$' },
    },
    {
      name: 'renderer-backend-whitelist',
      comment: 'R5 (ADR-003): renderer imports only pure types/utils/constants/logging, chat codecs, network/proxy, config/defaults',
      severity: 'error',
      from: { path: '^packages/desktop/src/renderer' },
      to: {
        path: '^packages/backend/src',
        pathNot:
          '^packages/backend/src/(types|utils|constants|logging|chat|i18n)/|^packages/backend/src/config/defaults\\.ts$|^packages/backend/src/network/proxy\\.ts$',
      },
    },
    {
      name: 'shells-no-db-migrations',
      comment: 'R6 (narrow): shells never touch migration machinery; broaden the shell whitelist in a later phase',
      severity: 'error',
      from: { path: '^packages/(desktop|daemon)' },
      to: { path: 'packages/backend/src/db/migration' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsConfig: { fileName: 'tsconfig.json' },
  },
};
