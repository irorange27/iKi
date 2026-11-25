import type { DocPage } from './types';

export const RUNTIME_DOC_PAGES: DocPage[] = [
  {
    slug: 'swarm-and-jobs',
    category: { en: 'Core Systems', zh: '核心机制' },
    title: { en: 'Swarm & Durable Jobs', zh: 'Swarm 协作与持久化后台任务' },
    summary: {
      en: 'Orchestrate isolated git-worktree workers with role-based models, shared board deltas, and timeout-promoted shell jobs.',
      zh: '使用 git-worktree 隔离的并行 Worker、按角色分配模型、增量消息板与超时自动转后台的持久化任务。',
    },
    sections: [
      {
        id: 'workspace-modes',
        title: { en: 'Worker Workspace Isolation', zh: 'Worker 工作区隔离模式' },
        blocks: [
          {
            kind: 'p',
            text: {
              en: 'Each spawned worker chooses an explicit workspace strategy so parallel edits never collide with the coordinator or other workers:',
              zh: '每个派生出的 Worker 都可以显式指定工作区隔离模式，确保并行修改文件时互不冲突：',
            },
          },
          {
            kind: 'table',
            headers: {
              en: ['Mode', 'Mechanism', 'Best For'],
              zh: ['模式', '底层机制', '适用场景'],
            },
            rows: [
              { en: ['inherit', 'Shares the parent working directory directly', 'Read-only research, audits, code inspection'], zh: ['inherit', '直接复用主线程工作目录', '只读调研、代码审查、架构分析'] },
              { en: ['share', 'Provisions a dedicated git worktree sharing .git objects', 'Parallel code edits, refactors, and builds without duplicating repo storage'], zh: ['share', '创建独立分支的 git worktree，共享 .git 对象库', '并行改代码、重构、跑测试（零重复磁盘拷贝）'] },
              { en: ['branch', 'Creates a fully isolated repository clone', 'Destructive experiments or independent git history operations'], zh: ['branch', '创建完全独立的仓库克隆', '破坏性实验或需要完全隔离 git 状态的操作'] },
            ],
          },
        ],
      },
      {
        id: 'live-observability',
        title: { en: 'Live Activity Strip & Watch Views', zh: '实时活动条与全屏看板' },
        blocks: [
          {
            kind: 'p',
            text: {
              en: 'Whenever a Swarm or background shell job is active, the TUI docks a compact real-time activity strip above the input editor showing each worker state (thinking, active tool call, elapsed time) and running job counters.',
              zh: '只要存在活跃的 Swarm 或后台任务，TUI 就会在输入框上方停靠紧凑的实时活动条，展示每个 Worker 当前思考/工具状态与后台任务计数。',
            },
          },
          {
            kind: 'ul',
            items: [
              {
                en: 'Press Ctrl+W (or run /swarm watch) to open the Swarm watch picker and stream any worker output or the shared message board live.',
                zh: '按 Ctrl+W（或运行 /swarm watch）打开 Swarm 选择器，实时切换查看任意 Worker 输出流或共享消息板。',
              },
              {
                en: 'Press Ctrl+J (or run /jobs) to open the durable background job viewer and tail stdout/stderr in real time.',
                zh: '按 Ctrl+J（或运行 /jobs）打开持久化后台任务视图，实时 tail 标准输出与错误日志。',
              },
              {
                en: 'Press Ctrl+K while watching a running job to terminate its process group immediately; press Esc to return to chat.',
                zh: '查看运行中任务时按 Ctrl+K 直接终止其进程组，按 Esc 随时返回主对话。',
              },
            ],
          },
        ],
      },
      {
        id: 'durable-shell',
        title: { en: 'Durable Background Shell Jobs', zh: '持久化后台 Shell 任务' },
        blocks: [
          {
            kind: 'p',
            text: {
              en: 'Long-running commands (builds, dev servers, full test suites) can run with background: true or automatically promote into durable jobs when they hit defaultTimeoutMs. All tunables live under [tools.shell] in ~/.iki/settings.toml:',
              zh: '耗时较长的构建、服务或测试命令既可显式传入 background: true，也可在到达 defaultTimeoutMs 时自动转入后台持久化运行。全部参数集中在 ~/.iki/settings.toml 的 [tools.shell]：',
            },
          },
          {
            kind: 'code',
            lang: 'toml',
            label: '~/.iki/settings.toml',
            code: `[tools.shell]\ndefaultTimeoutMs = 30000\nmaxTimeoutMs = 600000\npromoteOnTimeout = true\nmaxOutputBytes = 24000\nmaxOutputLines = 400`,
          },
        ],
      },
    ],
  },
  {
    slug: 'kv-cache-and-context',
    category: { en: 'Core Systems', zh: '核心机制' },
    title: { en: 'KV-Cache & Context Invariants', zh: 'KV-Cache 与上下文不变量' },
    summary: {
      en: 'Architectural rules that keep prompt prefixes byte-stable across multi-turn, multi-step, and MCP-enabled sessions.',
      zh: '保障多轮对话、多步工具调用与 MCP 动态挂载下 Prompt Prefix 始终字节稳定的核心约束。',
    },
    sections: [
      {
        id: 'static-slots',
        title: { en: 'Static System Prompt Slot Order', zh: '静态系统提示词槽位顺序' },
        blocks: [
          {
            kind: 'p',
            text: {
              en: 'Every model request assembles its system prompt through one single owner (@iki/system-prompt) in a deterministic slot order so provider prompt caches can reuse the entire leading prefix:',
              zh: '每一次模型请求都经由唯一组装器（@iki/system-prompt）按确定性槽位顺序拼接系统提示词，确保服务商 Prompt Cache 稳定命中前缀：',
            },
          },
          {
            kind: 'code',
            lang: 'text',
            code: `1. persona           (~/.iki/PERSONA.md — day-granular, zero sub-day clock stamps)\n2. planPrompt        (static tool rules for active static tool set)\n3. extraPrompt       (caller-specific static role prompt, e.g. Swarm coordinator)\n4. transcriptSystem  (<project_context> AGENTS.md + static <skills> index)`,
          },
        ],
      },
      {
        id: 'anchored-deltas',
        title: { en: 'Anchored <system_reminder> Deltas', zh: '锚定式 <system_reminder> 增量' },
        blocks: [
          {
            kind: 'p',
            text: {
              en: 'Dynamic per-turn facts never touch the system prompt. Instead, they are inserted as role: "user" reminder messages anchored immediately before the user message that introduced the change, and persisted on the thread snapshot:',
              zh: '动态变化的上下文绝不回写系统提示词，而是以 role: "user" 提醒消息锚定在首次引入变化的 user 消息之前，并持久化在线程快照中：',
            },
          },
          {
            kind: 'ul',
            items: [
              {
                en: '<system_reminder name="runtime">: active workspace path and OS runtime facts.',
                zh: '<system_reminder name="runtime">：当前工作区路径与运行时环境事实。',
              },
              {
                en: '<system_reminder name="skills">: newly discovered or pinned skill instructions anchored once via thread.skills_snapshot.',
                zh: '<system_reminder name="skills">：按需发现或固定的 Skill 指南，通过 thread.skills_snapshot 仅锚定一次。',
              },
              {
                en: '<system_reminder name="mcp">: MCP Code Mode server connect / tool-update / disconnect deltas tracked by thread.mcp_snapshot.',
                zh: '<system_reminder name="mcp">：MCP Code Mode 的连接、目录变更与断开增量，由 thread.mcp_snapshot 精确追踪。',
              },
            ],
          },
        ],
      },
      {
        id: 'replay-and-compaction',
        title: { en: 'Chronological Replay & Compaction', zh: '时间序回放与历史压缩' },
        blocks: [
          {
            kind: 'p',
            text: {
              en: 'Multi-step tool turns replay strictly as chronological [assistant, tool, assistant, ...] messages without double-wrapping tool outputs, and every provider request forwards sessionId: threadId. When context approaches budget limits (or on /compact), iKi writes an explicit compaction checkpoint event to ~/.iki/sessions/<threadId>.jsonl and resumes with a <compacted-summary> user message.',
              zh: '多步工具轮次严格按 [assistant, tool, assistant, ...] 时间序回放且不二次包裹工具输出，每次请求均透传 sessionId: threadId。当上下文接近预算上限（或手动执行 /compact）时，iKi 将压缩检查点写入 ~/.iki/sessions/<threadId>.jsonl，并以 <compacted-summary> 继续后续轮次。',
            },
          },
        ],
      },
    ],
  },
  {
    slug: 'architecture',
    category: { en: 'Engineering', zh: '工程架构' },
    title: { en: 'Monorepo Architecture & Gates', zh: 'Monorepo 架构与质量门禁' },
    summary: {
      en: 'Package boundaries, enforced architecture rules, testing layers, and packaging workflows for contributors.',
      zh: '面向贡献者与二次开发者的包边界规则、自动化架构门禁、测试分层与打包命令。',
    },
    sections: [
      {
        id: 'golden-rule',
        title: { en: 'The Golden Rule', zh: '单向依赖铁律' },
        blocks: [
          {
            kind: 'p',
            text: {
              en: 'All business logic lives in pure Node/TypeScript packages (packages/core through packages/harness). packages/cli and packages/desktop are thin presentation shells. Dependencies point strictly downward — verified on every check by .dependency-cruiser.cjs across all 517 modules.',
              zh: '全部业务逻辑均位于纯 Node/TypeScript 包（packages/core .. packages/harness），packages/cli 与 packages/desktop 仅为薄壳入口。依赖严格单向向下，每次门禁均由 .dependency-cruiser.cjs 扫描全部 517 个模块强校验。',
            },
          },
          {
            kind: 'note',
            tone: 'info',
            title: { en: 'Inspect any module contract before editing', zh: '修改核心代码前查看模块边界' },
            text: {
              en: 'Run pnpm run arch:context <module-id> (for example pnpm run arch:context harness/mcp) to print a bounded contract summary from scripts/module_registry.json.',
              zh: '运行 pnpm run arch:context <module-id>（例如 pnpm run arch:context harness/mcp）可从 scripts/module_registry.json 输出目标模块的完整边界与导出契约。',
            },
          },
        ],
      },
      {
        id: 'quality-gates',
        title: { en: 'Verification & Packaging Commands', zh: '质量门禁与打包命令' },
        blocks: [
          {
            kind: 'code',
            lang: 'bash',
            code: `# Full static quality gate (eslint, tsc, vue-tsc, depcruise, knip --production)\npnpm run ci:quality\n\n# Unit & integration tests (Vitest)\npnpm exec vitest run packages/*/tests\n\n# Keyless deterministic E2E (CLI & Desktop)\npnpm run test:e2e:cli:faux\npnpm run test:e2e\n\n# Build & pack zero-dependency standalone npm CLI (@irorange27/iki)\npnpm run cli:pack\n\n# Build this brand & documentation site\npnpm run site:build`,
          },
        ],
      },
    ],
  },
];
