# @iki/agent

Agent 原语与工具/步进抽象层；定义纯运行契约与基础工具注册表，不含具体模型供应或会话持久化。

## 职责

- **配置与结果类型**：`types.ts` 定义 `AgentConfig`、`AgentTool`、`AgentResult`、`AgentUsage`、`AgentTurnPerf` 与审批策略类型。
- **执行步进事件**：`agent_step.ts` 定义 `AgentStep` 联合类型（文本/思考增量、工具启停、审批请求、step/turn 结束）。
- **工具抽象**：`base_tool.ts` 提供 `BaseTool` 基类与全局 `defaultToolRegistry`；`json_schema.ts` 负责 zod schema 转 JSON Schema。
- **统一出口**：[src/index.ts](src/index.ts) 重导出核心类型与工具注册原语。

## 边界

- 只依赖 `@iki/core`；不认识 LLM adapter（`@iki/llm-pi-ai`）、会话日志（`@iki/session`）或业务编排（`@iki/harness`）。
- `@iki/agent-loop` 与 `@iki/harness` 依赖本包，依赖方向严格单向。

## 主要入口

| 文件 | 作用 |
|---|---|
| [src/index.ts](src/index.ts) | 公共类型、`BaseTool` 与 `defaultToolRegistry` 出口 |
| [src/types.ts](src/types.ts) | Agent 配置、工具接口、用量与审批策略 schema |
| [src/agent_step.ts](src/agent_step.ts) | `AgentStep` 模型与工具执行步进事件类型 |
| [src/base_tool.ts](src/base_tool.ts) | `BaseTool` 与内置工具注册表 |
| [src/json_schema.ts](src/json_schema.ts) | zod schema → 工具 JSON Schema 转换 |

## 常用命令

```sh
pnpm run ci:quality
pnpm exec vitest run <path>
```
