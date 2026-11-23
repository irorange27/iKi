# @iki/cli

基于 `@earendil-works/pi-tui` 的命令行交互与单次执行入口，复用 `@iki/harness` 驱动本地会话、仓库上下文检测与模型交互。

## 职责

- **入口分发**：`main.ts` 解析 CLI 参数（`--thread`、`--continue`、`--provider`、`--model`、`--workspace`、`--print`、`--json` 等），默认进入交互模式，也支持单次 `--print` / JSON 输出。
- **交互界面**：`interactive.ts` 基于 `pi-tui` 渲染消息流、工具执行卡片、双行右对齐 footer、slash 命令自动补全与思考指示。
- **命令与选择器**：`commands.ts` 定义内置 `/` 命令（如 `/models`、`/compact`、`/jobs`、`/context`、`/skills`、`/new`、`/thread` 等）；`selectors.ts` 提供可搜索的交互式浮层选择器；`tool_render.ts` 渲染 `bash`/`pwsh`/`job` 工具参数、命令与尾部输出预览。
- **主题样式**：`theme.ts` 定义终端暗色主题配色、编辑器主题与列表高亮。

## 边界

- 薄壳前端：依赖 `@iki/core`、`@iki/store`、`@iki/harness` 与 `@earendil-works/pi-tui`。
- 不直接实现模型适配器或工具内部逻辑；对话状态、压缩与工具执行一律委托给 `@iki/harness`。

## 主要入口

| 文件 | 作用 |
|---|---|
| [src/main.ts](src/main.ts) | CLI bin 入口、平台初始化与 interactive / print 分发 |
| [src/interactive.ts](src/interactive.ts) | `pi-tui` 交互循环、工具卡片渲染与流式输出 |
| [src/commands.ts](src/commands.ts) | `/` 内置斜杠命令注册与自动补全定义 |
| [src/selectors.ts](src/selectors.ts) | 模型、会话、技能等交互式选择器浮层 |
| [src/tool_render.ts](src/tool_render.ts) | `bash`/`pwsh`/`job` 工具参数与结果尾部预览渲染 |
| [src/turn_view.ts](src/turn_view.ts) | 单轮时间序视图（thinking / text / 工具卡片顺序渲染与 `Ctrl+T` 折叠展开） |
| [src/theme.ts](src/theme.ts) | CLI 终端 RGB 配色与 UI 组件样式 |

## 常用命令

```sh
pnpm cli
pnpm exec vitest run packages/cli/tests
node tests/integration/e2e/run_cli_faux_e2e.mjs
```
