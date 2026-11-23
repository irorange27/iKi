# @iki/session

基于只追加 JSONL 文件的底层会话事件存储；为每个会话维护按版本递增的 `sessions/<threadId>.jsonl` 事件流。

## 职责

- **存储实现**：`session_log_store.ts`（`createJsonlSessionLogStore`）提供单文件 JSONL 的读取、按 revision 乐观追加、消息检索与会话删除。
- **门面 API**：`session_events.ts` 对上层暴露 `getSessionEvents`、`appendSessionEvents`、`appendSessionFacts`、`insertSessionEventsAtHead`、`getSessionEventRevision`、`deleteSessionEvents` 与 `findMessageEvent`。

## 边界

- 只依赖 `@iki/store`（复用 `storeRoot()` 与底层目录约定）。
- 不解释业务事件语义（语义与状态归约由 `@iki/harness/thread_session/session_log` 负责）。

## 主要入口

| 文件 | 作用 |
|---|---|
| [src/session_events.ts](src/session_events.ts) | 全局默认 store ROOT 下的会话事件读写门面 |
| [src/session_log_store.ts](src/session_log_store.ts) | 文件型 append-only JSONL 会话日志存储引擎 |

## 常用命令

```sh
pnpm run ci:quality
pnpm exec vitest run packages/session/tests
```
