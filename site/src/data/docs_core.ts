import type { DocPage } from './types';

export const CORE_DOC_PAGES: DocPage[] = [
  {
    slug: 'getting-started',
    category: { en: 'Guide', zh: '入门指南' },
    title: { en: 'Getting Started', zh: '快速开始' },
    summary: {
      en: 'Install @irorange27/iki on Node 24+, bootstrap a provider with zero manual config, and keep the CLI updated.',
      zh: '在 Node 24+ 上安装 @irorange27/iki、零手写配置启动首个会话，以及使用内建自更新。',
    },
    sections: [
      {
        id: 'install',
        title: { en: 'Installation', zh: '安装' },
        blocks: [
          {
            kind: 'p',
            text: {
              en: 'iKi requires Node.js 24+ (used for native TypeScript stripping inside the PTC sandbox). The published CLI package @irorange27/iki ships as a single self-contained ESM executable with zero runtime dependencies.',
              zh: 'iKi 需要 Node.js 24+（PTC 沙箱直接复用 Node 24 内置的 stripTypeScriptTypes）。发布版 CLI 包 @irorange27/iki 为单文件独立可执行包，0 运行时依赖。',
            },
          },
          {
            kind: 'code',
            lang: 'bash',
            label: 'npm / npx',
            code: `# Global install\nnpm install -g @irorange27/iki\niki\n\n# Or run directly without global install\nnpx @irorange27/iki`,
          },
          {
            kind: 'code',
            lang: 'bash',
            label: 'From source (monorepo)',
            code: `git clone https://github.com/irorange27/iKi.git\ncd iKi\ncorepack enable && pnpm install --frozen-lockfile\npnpm cli        # interactive TUI\npnpm cli:pack   # build standalone @irorange27/iki tarball`,
          },
        ],
      },
      {
        id: 'zero-config',
        title: { en: 'Zero-Config Provider Setup', zh: '零手动配置与首次引导' },
        blocks: [
          {
            kind: 'p',
            text: {
              en: 'Powered directly by @earendil-works/pi-ai (40+ built-in providers, 1,600+ catalog models, and all 10 native wire APIs including Anthropic Messages, OpenAI Responses/Completions/Codex, Google Gemini/Vertex, AWS Bedrock, Azure, and Mistral). When ~/.iki/models.toml has no enabled providers, iKi auto-detects standard environment variables on startup without overwriting existing user entries.',
              zh: '底层直接接入 @earendil-works/pi-ai 全量生态（40+ 内置服务商、1,600+ 模型目录与全部 10 种原生协议：Anthropic Messages、OpenAI Responses/Completions/Codex、Google Gemini/Vertex、AWS Bedrock、Azure、Mistral 等）。当 ~/.iki/models.toml 中没有已启用 provider 时，启动会自动探测常见环境变量并生成配置（绝不覆盖已有条目）。',
            },
          },
          {
            kind: 'table',
            headers: {
              en: ['Provider Family (Examples)', 'Native Wire API', 'Auto-Detected Env Key'],
              zh: ['服务商示例（共 40+ 家）', '原生协议 API', '自动探测环境变量'],
            },
            rows: [
              { en: ['anthropic', 'anthropic-messages', 'ANTHROPIC_API_KEY'], zh: ['anthropic', 'anthropic-messages', 'ANTHROPIC_API_KEY'] },
              { en: ['openai / openai-codex / azure', 'openai-responses / azure-openai-responses', 'OPENAI_API_KEY, AZURE_OPENAI_API_KEY'], zh: ['openai / openai-codex / azure', 'openai-responses / azure-openai-responses', 'OPENAI_API_KEY, AZURE_OPENAI_API_KEY'] },
              { en: ['google / google-vertex', 'google-generative-ai / google-vertex', 'GEMINI_API_KEY, GOOGLE_CLOUD_API_KEY'], zh: ['google / google-vertex', 'google-generative-ai / google-vertex', 'GEMINI_API_KEY, GOOGLE_CLOUD_API_KEY'] },
              { en: ['amazon-bedrock', 'bedrock-converse-stream', 'AWS credentials / bearer token'], zh: ['amazon-bedrock', 'bedrock-converse-stream', 'AWS 凭证 / bearer token'] },
              { en: ['mistral', 'mistral-conversations', 'MISTRAL_API_KEY'], zh: ['mistral', 'mistral-conversations', 'MISTRAL_API_KEY'] },
              { en: ['deepseek / moonshotai-cn / kimi-coding / minimax / qwen-token-plan-cn / zai-coding-cn', 'openai-completions / anthropic-messages', 'DEEPSEEK_API_KEY, MOONSHOT_API_KEY, KIMI_API_KEY, MINIMAX_API_KEY, ZAI_CODING_CN_API_KEY, ...'], zh: ['deepseek / moonshotai-cn / kimi-coding / minimax / qwen-token-plan-cn / zai-coding-cn', 'openai-completions / anthropic-messages', 'DEEPSEEK_API_KEY, MOONSHOT_API_KEY, KIMI_API_KEY, MINIMAX_API_KEY, ZAI_CODING_CN_API_KEY 等'] },
              { en: ['openrouter / groq / xai / cerebras / together / fireworks / huggingface / vercel-ai-gateway', 'native per-model pi-ai API', 'OPENROUTER_API_KEY, GROQ_API_KEY, XAI_API_KEY, HF_TOKEN, ...'], zh: ['openrouter / groq / xai / cerebras / together / fireworks / huggingface / vercel-ai-gateway', '按模型自动匹配 pi-ai 原生 API', 'OPENROUTER_API_KEY, GROQ_API_KEY, XAI_API_KEY, HF_TOKEN 等'] },
              { en: ['Custom gateways (OpenAI Completions / Responses / Anthropic Messages)', 'openai-completions / openai-responses / anthropic-messages', 'IKI_BASE_URL (+ IKI_API_KEY, IKI_MODEL) or `iki setup`'], zh: ['自定义兼容网关（OpenAI Completions / Responses / Anthropic Messages）', 'openai-completions / openai-responses / anthropic-messages', 'IKI_BASE_URL（+ IKI_API_KEY、IKI_MODEL）或 `iki setup`'] },
            ],
          },
          {
            kind: 'p',
            text: {
              en: 'If no environment keys are set in a TTY, iKi launches the interactive onboarding wizard automatically. Inside `iki setup`, enter a number, type any pi-ai provider ID directly (e.g. `groq`, `mistral`, `amazon-bedrock`), or type `all` to browse all 40+ built-in providers:',
              zh: '如果未设置环境变量且在终端中启动，iKi 会自动进入交互式配置向导。在 `iki setup` 中可输入编号、直接输入任意 pi-ai provider ID（如 `groq`、`mistral`、`amazon-bedrock`），或输入 `all` 浏览全部 40+ 内置服务商：',
            },
          },
          {
            kind: 'code',
            lang: 'bash',
            code: `iki setup`,
          },
        ],
      },
      {
        id: 'updates',
        title: { en: 'Self-Update & Version Checks', zh: '版本检测与自更新' },
        blocks: [
          {
            kind: 'p',
            text: {
              en: 'Interactive sessions read a local 12-hour cache (~/.iki/state/cli_update_check.json) with zero startup latency and refresh silently in the background. Disable checks via IKI_NO_UPDATE_CHECK=1 or [general].autoUpdate = false in settings.toml.',
              zh: '交互模式启动时同步读取本地 12 小时缓存（~/.iki/state/cli_update_check.json），零阻塞启动并在后台静默刷新。可通过环境变量 IKI_NO_UPDATE_CHECK=1 或 settings.toml 中 [general].autoUpdate = false 关闭。',
            },
          },
          {
            kind: 'code',
            lang: 'bash',
            code: `iki --version        # print current CLI version\niki update --check   # check npm registry without installing\niki update           # auto-detect npm / pnpm / bun and upgrade to @latest`,
          },
        ],
      },
    ],
  },
  {
    slug: 'cli-reference',
    category: { en: 'Guide', zh: '入门指南' },
    title: { en: 'CLI Reference', zh: 'CLI 命令与快捷键参考' },
    summary: {
      en: 'Complete reference for CLI flags, headless execution, interactive keybindings, and all TUI slash commands.',
      zh: '所有命令行参数、无头脚本模式、全屏 TUI 快捷键与内置斜杠命令的完整速查。',
    },
    sections: [
      {
        id: 'flags',
        title: { en: 'Command-Line Options', zh: '命令行启动参数' },
        blocks: [
          {
            kind: 'table',
            headers: {
              en: ['Command / Flag', 'Description'],
              zh: ['命令 / 参数', '说明'],
            },
            rows: [
              { en: ['iki', 'Start fullscreen pi-tui interactive session in current directory'], zh: ['iki', '在当前目录启动全屏交互式 TUI'] },
              { en: ['iki setup', 'Run interactive provider setup wizard (writes models.toml)'], zh: ['iki setup', '运行交互式 Provider 配置向导（写入 models.toml）'] },
              { en: ['iki update [--check]', 'Check or upgrade @irorange27/iki to latest version'], zh: ['iki update [--check]', '检测或升级 @irorange27/iki 到最新版本'] },
              { en: ['-i, --interactive', 'Force interactive REPL mode (supports piped multi-line scripts)'], zh: ['-i, --interactive', '强制进入交互 REPL 模式（支持管道多行输入）'] },
              { en: ['-p, --print [prompt]', 'Run a single non-interactive turn and exit'], zh: ['-p, --print [prompt]', '单轮无头执行并退出'] },
              { en: ['--json', 'Output structured JSON { success, threadId, runId, text, usage }'], zh: ['--json', '输出结构化 JSON 摘要（含 threadId、text、usage）'] },
              { en: ['-c, --continue', 'Resume the most recently saved thread'], zh: ['-c, --continue', '恢复最近一次保存的会话线程'] },
              { en: ['--thread <id>', 'Attach to an existing thread ID or create a named thread'], zh: ['--thread <id>', '指定或新建会话线程 ID'] },
              { en: ['-C, --workspace <dir>', 'Set workspace directory (defaults to process.cwd() in TUI)'], zh: ['-C, --workspace <dir>', '指定工作区根目录（TUI 下默认当前目录）'] },
              { en: ['--data-dir <dir>', 'Override state directory (default ~/.iki or IKI_DATA_DIR)'], zh: ['--data-dir <dir>', '覆盖本地数据目录（默认 ~/.iki 或 IKI_DATA_DIR）'] },
              { en: ['--provider <type>', 'Select provider type (openai, anthropic, deepseek, openai-compatible)'], zh: ['--provider <type>', '指定 provider 类型（openai / anthropic / deepseek 等）'] },
              { en: ['--provider-id <id>', 'Select a specific provider key from models.toml'], zh: ['--provider-id <id>', '指定 models.toml 中的具体 provider ID'] },
              { en: ['--model <id>', 'Select model ID for the session'], zh: ['--model <id>', '指定本次会话使用的模型 ID'] },
              { en: ['--tools <a,b>', 'Restrict enabled tool names (e.g. bash,job,ptc)'], zh: ['--tools <a,b>', '显式限定启用的工具列表'] },
              { en: ['--mcp <s1,s2>', 'Connect specific configured MCP servers on startup'], zh: ['--mcp <s1,s2>', '启动时连接指定的已配置 MCP Server'] },
              { en: ['--skills <a,b>', 'Pin specific discovered skill IDs'], zh: ['--skills <a,b>', '固定指定的 Skill ID 列表'] },
              { en: ['--skill-mode <auto|manual>', 'Control automatic vs manual skill loading'], zh: ['--skill-mode <auto|manual>', '切换 Skill 自动发现或手动固定模式'] },
            ],
          },
          {
            kind: 'code',
            lang: 'bash',
            label: 'Headless / CI examples',
            code: `iki -p "Summarize git diff --stat and flag risky changes"\niki --json -C /path/to/repo "List exported hooks in packages/harness"\niki -c "Now write unit tests for the edge cases"`,
          },
        ],
      },
      {
        id: 'shortcuts',
        title: { en: 'Keyboard Shortcuts', zh: '终端快捷键' },
        blocks: [
          {
            kind: 'table',
            headers: {
              en: ['Shortcut', 'Action'],
              zh: ['快捷键', '功能'],
            },
            rows: [
              { en: ['Ctrl+W', 'Open live Swarm watch picker (workers + shared message board)'], zh: ['Ctrl+W', '打开 Swarm 实时看板选择器（各 Worker 流 + 共享消息板）'] },
              { en: ['Ctrl+J', 'Open durable background Jobs live log viewer'], zh: ['Ctrl+J', '打开持久化后台任务实时日志看板'] },
              { en: ['Ctrl+K', 'Kill the running background job while inside the job watch view'], zh: ['Ctrl+K', '在后台任务日志视图中直接终止当前运行任务'] },
              { en: ['Ctrl+T', 'Toggle inline thinking / reasoning trace expansion'], zh: ['Ctrl+T', '展开或折叠模型思考过程（thinking）'] },
              { en: ['Esc', 'Return from watch views to chat, or abort the active model turn'], zh: ['Esc', '从监控视图返回对话，或中断当前生成'] },
              { en: ['Ctrl+C / Ctrl+D', 'Interrupt active turn (press twice or Ctrl+D on empty input to exit)'], zh: ['Ctrl+C / Ctrl+D', '中断当前轮次（空输入按 Ctrl+D 或双击 Ctrl+C 退出）'] },
            ],
          },
        ],
      },
      {
        id: 'slash-commands',
        title: { en: 'Interactive Slash Commands', zh: '交互式斜杠命令' },
        blocks: [
          {
            kind: 'table',
            headers: {
              en: ['Command', 'Purpose'],
              zh: ['命令', '用途'],
            },
            rows: [
              { en: ['/mcp [status|tools|dts|mode|add|add-http|import|connect|disconnect|refresh|remove]', 'Full MCP server lifecycle, Code Mode (.d.ts) inspection, and Claude/Cursor mcp.json import'], zh: ['/mcp [status|tools|dts|mode|add|add-http|import|connect|disconnect|refresh|remove]', '管理 MCP Server、查看 Code Mode TS 声明（/mcp dts）及导入 mcp.json'] },
              { en: ['/swarm <goal> | watch | status | model | stop', 'Coordinate parallel git-worktree workers, switch role models, and watch live output'], zh: ['/swarm <目标> | watch | status | model | stop', '发起多 Agent Swarm 协作、切换角色模型并打开实时监控'] },
              { en: ['/jobs [all | log <id> | kill <id>]', 'Inspect, tail, or kill durable background shell jobs'], zh: ['/jobs [all | log <id> | kill <id>]', '查看、追踪日志或终止持久化后台 shell 任务'] },
              { en: ['/models [refresh] | /model <id>', 'Interactive searchable model switcher with live endpoint discovery'], zh: ['/models [refresh] | /model <id>', '打开可搜索模型选择器（支持实时拉取网关模型）'] },
              { en: ['/skills [auto|manual|clear|id1,id2]', 'Browse, switch mode, or pin workspace & user skills'], zh: ['/skills [auto|manual|clear|id1,id2]', '浏览、切换模式或固定已发现的 Skills'] },
              { en: ['/tools [default|all|none|a,b]', 'View or override active tools for subsequent turns'], zh: ['/tools [default|all|none|a,b]', '查看或覆写后续轮次启用的工具集'] },
              { en: ['/context · /system', 'Inspect loaded AGENTS.md, PERSONA.md, skills, MCP summary, and composed system prompt'], zh: ['/context · /system', '检查已加载的 AGENTS.md、PERSONA.md、Skills、MCP 状态与完整系统提示词'] },
              { en: ['/compact · /history', 'Compact older turns into a persistent checkpoint or inspect thread history'], zh: ['/compact · /history', '手动将较早轮次压缩为持久化检查点，或查看会话历史'] },
              { en: ['/resume · /thread <id> · /new [title]', 'Pick and resume saved threads or start a fresh thread'], zh: ['/resume · /thread <id> · /new [title]', '切换恢复历史会话或新建线程'] },
              { en: ['/usage · /copy · /clear · /exit', 'Inspect session token/cache totals, copy last reply, clear screen, or exit'], zh: ['/usage · /copy · /clear · /exit', '查看累计 token 与缓存统计、复制末条回复、清屏或退出'] },
            ],
          },
        ],
      },
    ],
  },
  {
    slug: 'mcp-code-mode',
    category: { en: 'Core Systems', zh: '核心机制' },
    title: { en: 'MCP Code Mode & PTC Sandbox', zh: 'MCP Code Mode 与 PTC 沙箱' },
    summary: {
      en: 'How iKi replaces bloated top-level MCP JSON Schemas with progressive TypeScript declarations and an isolated node:vm execution sandbox.',
      zh: '深入理解 iKi 如何用渐进式 TypeScript 声明与隔离 node:vm 沙箱替代膨胀的顶层 MCP JSON Schema。',
    },
    sections: [
      {
        id: 'three-levels',
        title: { en: 'Progressive Disclosure (L0 / L1 / L2)', zh: '三级渐进式披露（L0 / L1 / L2）' },
        blocks: [
          {
            kind: 'p',
            text: {
              en: 'When [mcp].exposureMode is "code" (the default), top-level LLM tools stay strictly frozen to builtin primitives (bash/pwsh, job, ptc). Connected MCP servers never bloat the tool schema array:',
              zh: '在默认 [mcp].exposureMode = "code" 模式下，顶层 LLM tools 严格冻结为 3 个核心内置工具（bash/pwsh、job、ptc），已连接的 MCP Server 不会污染顶层工具数组：',
            },
          },
          {
            kind: 'ul',
            items: [
              {
                en: 'L0 Anchored Delta: Small servers (≤ 6 tools and ≤ 480 chars) inline single-line compact TypeScript signatures inside a <system_reminder name="mcp"> anchored once before the triggering user message. Larger servers list only tool names plus an mcp.describe("<server>") hint.',
                zh: 'L0 增量锚定摘要：小型服务（≤ 6 工具且 ≤ 480 字符）在锚定于触发轮次的 <system_reminder name="mcp"> 中内联单行紧凑 TS 签名；大型服务仅给工具名列表 + mcp.describe("<server>") 提示。',
              },
              {
                en: 'L1 On-Demand .d.ts: Inside ptc (or interactively via /mcp dts [server] [tool]), iKi compiles JSON Schemas on the fly into clean declare namespace mcp.<server> TypeScript declarations.',
                zh: 'L1 按需 .d.ts：模型在 ptc 中调用 mcp.describe(server, tool?)（或用户在 CLI 执行 /mcp dts），即时获得从 JSON Schema 编译出的 declare namespace mcp.<server> 声明。',
              },
              {
                en: 'L2 Programmatic Execution: Inside ptc, scripts invoke await mcp.<server>.<tool>(args) with full Promise.all concurrency, local filtering, and automatic normalization of MCP CallToolResult into { content, text, data? }.',
                zh: 'L2 编程式执行：在 ptc 沙箱内通过 await mcp.<server>.<tool>(args) 并发编排、本地过滤聚合，并自动将 MCP 原始 CallToolResult 归一化为 { content, text, data? }。',
              },
            ],
          },
          {
            kind: 'code',
            lang: 'typescript',
            label: 'Generated L1 declaration (/mcp dts calc)',
            code: `type McpResult<T = any> = { content: unknown[]; text?: string; data?: T; isError?: boolean };\ndeclare namespace mcp.calc {\n  /** Add two numbers a and b */\n  function add(args: { a: number; b: number }): Promise<McpResult>;\n  /** Compute n * n and return JSON { n, squared } */\n  function square(args: { n: number }): Promise<McpResult>;\n}`,
          },
        ],
      },
      {
        id: 'sandbox-api',
        title: { en: 'PTC Sandbox Globals & Guardrails', zh: 'PTC 沙箱内置对象与安全护栏' },
        blocks: [
          {
            kind: 'p',
            text: {
              en: 'PTC runs TypeScript or JavaScript snippets inside an isolated node:vm context with codeGeneration disabled (no eval / new Function), no process/fs/require globals, recursion blocking (ptc cannot call ptc), per-run tool-call caps, and hard execution timeouts.',
              zh: 'PTC 在隔离的 node:vm 上下文中执行 TypeScript/JavaScript 片段：禁用 eval / new Function，不暴露 process/fs/require，内置防递归调用（ptc 不可调用 ptc）、最大工具调用次数上限与硬超时控制。',
            },
          },
          {
            kind: 'code',
            lang: 'typescript',
            label: 'Available globals inside a ptc script',
            code: `// 1. First-class MCP namespace\nconst servers = mcp.servers();               // [{ name, label, toolCount, tools }]\nconst dts = mcp.describe('github');          // declare namespace mcp.github { ... }\nconst res = await mcp.github.list_issues({ repo: 'iki', state: 'open' });\nconst viaCall = await mcp.call('github', 'list_issues', { repo: 'iki' });\n\n// 2. Built-in tools bridge\nconst builtins = tools.list();\nconst out = await tools.bash({ command: 'git status -s' });\n\n// 3. Utilities\nconsole.log('workspace:', workspace);\nawait sleep(100);\nreturn { issues: res.data, status: out };`,
          },
        ],
      },
      {
        id: 'import-and-config',
        title: { en: 'Importing mcp.json & Settings', zh: '导入 mcp.json 与配置项' },
        blocks: [
          {
            kind: 'code',
            lang: 'bash',
            label: 'Drop-in import & mode switch',
            code: `# Auto-discovers <workspace>/.mcp.json, <workspace>/.iki/mcp.json, or ~/.iki/mcp.json\n/mcp import\n\n# Add a local stdio or HTTP server directly\n/mcp add github npx -y @modelcontextprotocol/server-github\n/mcp add-http docs https://mcp.example.com/sse\n\n# Switch between Code Mode (default) and legacy direct top-level tools\n/mcp mode code\n/mcp mode direct`,
          },
          {
            kind: 'code',
            lang: 'toml',
            label: '~/.iki/settings.toml',
            code: `[mcp]\nenabled = true\nexposureMode = "code"      # "code" (default) | "direct"\nconnectOnStartup = true\nrequestTimeoutMs = 20000\nmaxConcurrentRequests = 4\n\n[tools.ptc]\nenabled = true\ndefaultTimeoutMs = 30000\nmaxTimeoutMs = 120000\nmaxToolCalls = 32\nmaxOutputBytes = 32768`,
          },
        ],
      },
    ],
  },
];
