# @iki/agent-loop

通用 multi-step 模型执行循环；把 LLM 流式响应、工具调用执行、审批门控与用量汇总串联成异步生成器。

## 职责

- **核心循环**：`agent_loop.ts` 驱动多轮 `model -> tool_call -> tool_result -> model` 步进，并在每步发射 `LoopEvent`（`text_delta`、`thinking_delta`、`step_end`、`tool_start`、`tool_end`）。
- **工具结果规范化**：复用 `@iki/llm/message/model_history` 的 `toolResultText` / `toolResultIsError` 把工具输出转为可回传模型的形态。
- **用量统计**：按步汇总 `input`、`output`、`cacheRead`、`cacheWrite`、`reasoning` 与成本。

## 边界

- 只依赖 `@iki/agent` 与 `@iki/llm`；不直接读写 `@iki/store` / `@iki/session`，也不做具体提示词拼装。
- 业务层的预算检查、compaction、恢复与取消语义由 `@iki/harness` 通过 hooks 注入。

## 主要入口

| 文件 | 作用 |
|---|---|
| [src/index.ts](src/index.ts) | 重导出 `agent_loop.ts` 全部循环 API |
| [src/agent_loop.ts](src/agent_loop.ts) | 多步执行循环与 `LoopStep` / `LoopUsageBuckets` 定义 |

## 常用命令

```sh
pnpm run ci:quality
pnpm exec vitest run packages/agent-loop/tests
```
