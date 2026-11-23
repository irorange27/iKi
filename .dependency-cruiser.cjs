/**
 * Package boundary rules — see docs/process/architecture-factoring.md (P1) and
 * docs/conventions.md. Enforcement for what ADR-003 left as convention.
 *
 * R1–R4 are fully strict: P2 resolved the provider/tools exemptions (leaf moves +
 * DI at registration) and P3 resolved the config-injection exemptions in
 * turn_prep (getRuntimeConfig wired in thread_session/session_loop.ts).
 */
module.exports = {
  forbidden: [
    {
      name: 'core-is-a-leaf',
      comment: '@iki/core holds types/utils/logging/platform and must not reach any consumer: it is what every other package depends on.',
      severity: 'error',
      from: { path: '^packages/core/src' },
      to: { path: '^packages/(harness|store|session|llm|llm-pi-ai|agent|agent-loop|system-prompt|desktop)/' },
    },
    {
      name: 'system-prompt-is-below-llm-and-harness',
      comment: '@iki/system-prompt depends only on @iki/core; it must not reach store, session, llm, agent, harness, or desktop.',
      severity: 'error',
      from: { path: '^packages/system-prompt/src' },
      to: { path: '^packages/(store|session|llm|llm-pi-ai|agent|agent-loop|harness|desktop)/' },
    },
    {
      name: 'agent-contracts-are-clean',
      comment: '@iki/agent defines Agent/Tool contracts and BaseTool; it must not reach agent-loop, orchestration, or shell.',
      severity: 'error',
      from: { path: '^packages/agent/src' },
      to: { path: '^packages/(agent-loop|harness|desktop)/' },
    },
    {
      name: 'agent-loop-is-pure',
      comment: '@iki/agent-loop is the pure loop engine; it must not reach store, session, harness orchestration, or shell.',
      severity: 'error',
      from: { path: '^packages/agent-loop/src' },
      to: { path: '^packages/(store|session|harness|desktop)/' },
    },
    {
      name: 'llm-below-orchestration',
      comment: '@iki/llm holds the model-neutral transcript types and provider contracts. It must not reach llm-pi-ai, orchestration, or shell.',
      severity: 'error',
      from: { path: '^packages/llm/src' },
      to: { path: '^packages/(llm-pi-ai|backend/src/(agent|tools|turn_prep|thread_session|mcp|runtimes|awaiters|workspaces)|desktop)/' },
    },
    {
      name: 'session-depends-on-core-and-store',
      comment: '@iki/session holds the append-only SessionEvent log.',
      severity: 'error',
      from: { path: '^packages/session/src' },
      to: { path: '^packages/(backend|llm|llm-pi-ai|desktop)/' },
    },
    {
      name: 'store-depends-only-on-core',
      comment: '@iki/store is the persistence layer: it may use core types/utilities and nothing above it.',
      severity: 'error',
      from: { path: '^packages/store/src' },
      to: { path: '^packages/(backend/src/(agent|tools|turn_prep|thread_session|mcp|runtimes|awaiters|workspaces)|session/src|llm/src|llm-pi-ai/src|desktop)/' },
    },
    {
      name: 'backend-owns-orchestration',
      comment: 'The backend composes core, store, tools, session and provider; it must never reach into the shell.',
      severity: 'error',
      from: { path: '^packages/harness/src' },
      to: { path: '^packages/desktop' },
    },
    {
      name: 'backend-stays-pure',
      comment: 'Golden rule: packages/harness is pure Node/TS — no Electron/Vue/Vite, no renderer SDKs',
      severity: 'error',
      from: { path: '^packages/harness' },
      to: { path: 'node_modules/(electron|vue|@vitejs/|@vue/|@ai-sdk/vue|@ai-sdk/react|happy-dom)' },
    },
    {
      name: 'no-reverse-dependency',
      comment: 'Dependencies point one way only: shells -> backend, never backend -> shells',
      severity: 'error',
      from: { path: '^packages/harness' },
      to: { path: '^packages/desktop' },
    },
    {
      name: 'provider-is-leaf',
      comment: 'R1: the provider adapters (@iki/llm/provider, @iki/llm-pi-ai) wire models; they must not reach up into tools/session/orchestration',
      severity: 'error',
      from: { path: '^packages/(llm/src/provider|llm-pi-ai/src)' },
      to: { path: '^packages/(backend/src/(tools|turn_prep|thread_session)|desktop)/' },
    },
    {
      name: 'tools-below-session',
      comment: 'R2: concrete tools stay below turn_prep/provider/thread_session (type-only DI contracts are not counted)',
      severity: 'error',
      from: { path: '^packages/harness/src/tools' },
      to: { path: '^packages/(backend/src/(turn_prep|thread_session)|llm/src/provider|llm-pi-ai/src)/' },
    },
    {
      name: 'agent-below-session-and-orchestration',
      comment: 'R3 (loop+harness only)',
      severity: 'error',
      from: { path: '^packages/harness/src/agent/' },
      to: { path: '^packages/harness/src/(turn_prep|thread_session)' },
    },
    {
      name: 'turn-prep-below-session',
      comment: 'R5 (stage F2): thread_session capabilities reach turn_prep only as injected ports (skills prompt, identity profile, continuity retrieval, continuity persist). The session composition roots own the real implementations.',
      severity: 'error',
      from: { path: '^packages/harness/src/turn_prep' },
      to: { path: '^packages/harness/src/thread_session' },
    },
    {
      name: 'db-migration-above-database',
      comment: 'The bootstrap handle flows down: database.ts opens the file and passes it into initializeMigrations(db); migration modules must never reach back for the getDb singleton (that edge is the module-level import cycle).',
      severity: 'error',
      from: { path: '^packages/harness/src/db/migration' },
      to: { path: '^packages/harness/src/db/database.ts$' },
    },
    {
      name: 'session-reads-no-global-config',
      comment: 'R4 (ADR-001, finished by P3): config is injected into turn_prep/agent; config/defaults.ts (pure constants) is fine',
      severity: 'error',
      from: { path: '^packages/harness/src/(turn_prep|agent)' },
      to: { path: '^packages/harness/src/config\\.ts$' },
    },
    {
      name: 'renderer-backend-whitelist',
      comment: 'R5 (ADR-003): renderer imports only pure types/utils/constants/logging, chat codecs, network/proxy, config/defaults, worktree id conventions',
      severity: 'error',
      from: { path: '^packages/desktop/src/renderer' },
      to: {
        path: '^packages/harness/src',
        pathNot:
          '^packages/harness/src/(types|utils|constants|logging|message|i18n)/|^packages/harness/src/config/defaults\\.ts$|^packages/harness/src/network/proxy\\.ts$|^packages/harness/src/workspaces/worktree_ids\\.ts$|^packages/harness/src/workspaces/thread_mode\\.ts$',
      },
    },
    {
      name: 'renderer-no-schema-heavy-closure',
      comment: 'R7 (P1): R5 only sees a renderer module\'s DIRECT edges, so a whitelisted backend module that reaches a heavy one smuggles the closure into the bundle (that is how tools/schemas got shipped — one transitive hop, 1.6 MB). Flag transitive reach too: nothing under renderer/ may arrive at tools/, provider/, thread_session/ or agent/ at any depth (`reachable: true` = indirect hops count as well as direct ones). db/ is deliberately absent: the one route there (Sidebar -> message/thread_content_search -> db/) is a type-only import that Vite erases, and R5 keeps governing it. Run with --ts-pre-compilation-deps to inspect type-only edges as well.',
      severity: 'error',
      from: { path: '^packages/desktop/src/renderer' },
      to: {
        path: '^packages/(backend/src/(tools|thread_session|agent)|llm/src/provider|llm-pi-ai/src)',
        reachable: true,
      },
    },
    {
      name: 'shells-no-db-migrations',
      comment: 'R6 (narrow): shells never touch migration machinery; broaden the shell whitelist in a later phase',
      severity: 'error',
      from: { path: '^packages/desktop' },
      to: { path: 'packages/harness/src/db/migration' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsConfig: { fileName: 'tsconfig.json' },
  },
};
