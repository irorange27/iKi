# @iki/cli

基于 `@earendil-works/pi-tui` 的交互式终端 TUI 与无头 CLI 入口，复用 `@iki/harness` 驱动多轮会话、MCP Code Mode、PTC 沙箱、多 Agent Swarm、持久化后台任务与零配置首次启动。

## 职责

- **零门槛启动与入口分发**：`main.ts` + `onboarding.ts` 解析 CLI 参数（`setup` / `--setup`、`--thread`、`--continue`、`--provider`、`--provider-id`、`--model`、`--workspace`、`--mcp`、`--skills`、`--print`、`--json`、`--version`），无配置时自动探测环境变量（`ANTHROPIC_API_KEY`、`OPENAI_API_KEY`、`DEEPSEEK_API_KEY`、`OPENROUTER_API_KEY`、`KIMI_API_KEY`、`GEMINI_API_KEY`、`IKI_BASE_URL`）或启动交互式配置向导。
- **交互 TUI 与实时看板**：`interactive.ts` + `live_monitor.ts` + `live_views.ts` 渲染流式消息、时间序工具卡片（`turn_view.ts`、`tool_render.ts`）、底部 Swarm/Jobs 实时活动条、`Ctrl+W`（Worker/消息板监控）、`Ctrl+J`（后台任务日志）、`Ctrl+K`（终止任务）与 `Ctrl+T`（思考折叠）。
- **命令与选择器**：`commands.ts`、`mcp_commands.ts`、`swarm_commands.ts`、`tui_pickers.ts`、`selectors.ts` 提供 `/mcp`（`add`/`add-http`/`import`/`tools`/`dts`/`mode`）、`/swarm`、`/jobs`、`/models`、`/skills`、`/resume`、`/compact`、`/context` 等命令与自动补全。
- **单文件打包**：通过 `pnpm cli:build`（`scripts/build_cli.mjs`）输出独立的 Node 24 可执行文件 `packages/cli/dist/iki.mjs`。

## 边界

- 薄壳前端：仅依赖 `@iki/core`、`@iki/store`、`@iki/harness`、`@iki/tools` 与 `@earendil-works/pi-tui`。
- 所有模型适配、MCP 管理、Swarm 编排、上下文预算与会话持久化一律委托给 `@iki/harness`。

## 主要入口

| 文件 | 作用 |
|---|---|
| [src/main.ts](src/main.ts) | CLI 入口、参数解析、环境变量引导与 interactive / print 分发 |
| [src/onboarding.ts](src/onboarding.ts) | 全量 `pi-ai` 环境变量自动探测与 `iki setup` 引导分发 |
| [src/setup_tui.ts](src/setup_tui.ts) | 基于 `pi-tui` 的全屏交互式配置向导（40+ provider 模糊搜索、脱敏 API Key 与模型选择器） |
| [src/updater.ts](src/updater.ts) | 12 小时缓存后台版本检测、`iki update [--check]` 自更新与包管理器识别 |
| [src/interactive.ts](src/interactive.ts) | `pi-tui` 全屏交互循环、快捷键路由与流式输出 |
| [src/commands.ts](src/commands.ts) | `/` 斜杠命令注册、自动补全与会话 Banner |
| [src/mcp_commands.ts](src/mcp_commands.ts) | `/mcp` 全套子命令（`status`/`tools`/`dts`/`mode`/`add`/`import` 等） |
| [src/swarm_commands.ts](src/swarm_commands.ts) | `/swarm` 编排、角色模型切换与实时监控命令 |
| [src/live_monitor.ts](src/live_monitor.ts) | 底部 Swarm Worker 与后台任务实时活动条 |
| [src/live_views.ts](src/live_views.ts) | 全屏 Worker 流、共享消息板与后台任务日志实时视图 |
| [src/tui_pickers.ts](src/tui_pickers.ts) | 模型、会话、技能、Swarm、Jobs 交互浮层选择器 |
| [src/tool_render.ts](src/tool_render.ts) | `bash`/`pwsh`/`job`/`ptc`/`mcp_*`/`swarm` 工具卡片渲染 |
| [src/turn_view.ts](src/turn_view.ts) | 单轮时间序视图与 `Ctrl+T` 思考折叠 |

## 常用命令

```sh
pnpm cli
pnpm cli setup
pnpm cli:build && node packages/cli/dist/iki.mjs --help
pnpm exec vitest run packages/cli/tests
pnpm run test:e2e:cli:faux
```
