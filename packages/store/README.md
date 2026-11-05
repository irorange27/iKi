# @iki/store

文件型持久化层：一个集合一个 JSON 文件，一个会话一个只追加的 JSONL 文件。

## 职责

- **集合**：`collection.ts` 提供 `readRows` / `commitRows` / `upsertRow` / `patchRow` / `removeRow`；每次读直接读盘、不留缓存，文件即真相。
- **会话日志**：`session_log_store.ts` + `session_events.ts` —— 每条会话一个 `sessions/<threadId>.jsonl`，只追加、整体读入、在内存里折叠。
- **Provider 声明**：`providers.ts` 读写 `models.toml`（TOML 表格，按 id 索引），每次读经 `@iki/core/domain/models` 校验并冻结；文件缺失或撕裂按空配置处理，下一次写修复。
- **业务行**：`chat_thread.ts`、`workspaces.ts`、`agent_runs.ts`、`awaiters.ts`、`mcp_servers.ts`、`prompt_apps.ts`、`chat_usage.ts`、`thread_run_locks.ts` 等。

## 边界

- 只依赖 `@iki/core`；不得向上 import `@iki/ai` / `@iki/backend` / `@iki/desktop`（depcruise 规则 `store-depends-only-on-core`）。
- 没有数据库引擎、没有 schema 与 migration。`database.ts` 只负责解析 store 根目录，`initializeDatabase({ dbPath })` 是保留旧名的兼容壳。
- 另一进程或手工改了文件，下一次读即可见；写操作整体替换，不做查询引擎。

## 主要入口

| 文件 | 作用 |
|---|---|
| [src/collection.ts](src/collection.ts) | 集合读写与 `storeRoot()` |
| [src/database.ts](src/database.ts) | store 根目录解析、初始化兼容壳 |
| [src/providers.ts](src/providers.ts) | `models.toml` 读写与 provider CRUD |
| [src/session_log_store.ts](src/session_log_store.ts) | append-only JSONL 存储 |
| [src/session_events.ts](src/session_events.ts) | 会话事件流的门面 |

用户数据落在 `<userData>/iki-store/`，provider 配置是同目录下的 `models.toml`。

## 常用命令

```sh
pnpm run ci:quality
pnpm exec vitest run <path>
```

## 改这里之前

- 根 [AGENTS.md](../../AGENTS.md)（尤其 Golden rule 与 backend 契约映射）。
- [docs/conventions.md](../../docs/conventions.md) —— 注意其中 SQLite / migration 段落已是历史快照。
- [docs/harness.md](../../docs/harness.md) —— 会话日志作为事实来源的概念模型。
