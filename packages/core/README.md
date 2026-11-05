# @iki/core

领域契约与平台无关的基础层，整个 monorepo 的 core。

## 职责

- **领域契约**：`domain/` 下的 zod schema 是唯一权威，TypeScript 类型是 `z.infer` 投影；一次 load 产出校验后的不可变快照。涵盖 `models`（provider 声明）、`session`、`settings`、`tools`、`events`、`runtime`。
- **共享类型**：`types/`（chat、session_events、provider、config、mcp、agent_run 等）。
- **基础工具**：`utils/`（id、路径边界、错误、重试、文本、provider 模型能力换算等）、`logger.ts` + `logging/`（日志）、`i18n/locale.ts`（locale 归一化）。
- **平台信息**：`platform.ts` / `platform_wiring.ts` —— 由宿主从外部注入 `userDataPath`、locale、主题等，本包不自己探测 Electron。

## 边界

- 不依赖任何 workspace 包（`package.json` 里没有 `@iki/*` 依赖），依赖方向恒为下层指向它。
- 不认识 Electron、IPC、Vue、集合存储、设置 UI；业务规则留在上层。
- 改 `domain/` 契约会波及 `@iki/store` / `@iki/ai` / `@iki/backend`，契约、边界回归、所有权映射一起改。

## 主要入口

| 文件 | 作用 |
|---|---|
| [src/domain/models.ts](src/domain/models.ts) | `models.toml` 的 zod 契约、`loadModelsConfig`、`toProvider` |
| [src/types/session_events.ts](src/types/session_events.ts) | 会话事件词汇与版本（唯一 owner） |
| [src/platform.ts](src/platform.ts) | 平台信息的注入与读取 |
| [src/logger.ts](src/logger.ts) | 结构化日志 |
| [src/utils/provider_models.ts](src/utils/provider_models.ts) | models.dev catalog → 模型能力 |

## 常用命令

```sh
pnpm run ci:quality                        # 完成门：lint + tsc + vue-tsc + 依赖方向 + knip
pnpm run arch:context backend/foundation  # 生成某模块的边界上下文
pnpm exec vitest run <path>                # 单个测试文件
```

## 改这里之前

- 根 [AGENTS.md](../../AGENTS.md) —— 架构地图、任务起点、工作流。
- [docs/conventions.md](../../docs/conventions.md) —— 代码约定、禁令与地雷。
- [scripts/module_registry.json](../../scripts/module_registry.json) —— `src` 下每个目录都要归属一个模块。
