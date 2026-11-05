# @iki/ai

消息编解码、UI 协议与模型供应层：把 iKi 的会话历史投影到 `@earendil-works/pi-ai`。

## 职责

- **消息 / UI 协议**：`message/` —— `ui_protocol.ts`（UI part 类型）、`ui_chunk_reducer.ts`（流式 chunk 归并）、`ui_messages.ts` / `model_messages.ts` / `ui_to_model.ts`（UI ↔ 模型投影）、`tool_payload_contracts.ts`（renderer 唯一可引用的 payload 解码）、`system_prompt.ts`、`thread_markdown_export.ts`。
- **模型供应**：`provider/llm/factory.ts`（provider 配置解析、Pi 路由、单次生成）、`pi_adapter.ts`（iKi 历史 → Pi wire 投影）、`model_discovery.ts`、`tool_model.ts`（辅助工具模型）、`prompt_text_generator.ts` / `title_runtime.ts` / `catalog_selection.ts`（辅助生成）。
- **网络**：`network/http.ts`、`proxy.ts`。

## 边界

- 依赖 `@iki/core` 与 `@iki/store`；不得向上 import `@iki/backend` / `@iki/desktop`。
- `provider/` 是叶子模块，不能伸进 tools / session / orchestration（depcruise R1）。
- 供应层只做投影：历史权威、上下文预算、工具执行、审批、事实提交都归各自 owner，投影产物是请求级临时值、不落盘。
- renderer 侧只引用 `tool_payload_contracts.ts`；别把 `tools/schemas`（含 zod）带进前端包。

## 主要入口

| 文件 | 作用 |
|---|---|
| [src/provider/llm/factory.ts](src/provider/llm/factory.ts) | `getProviderConfig`、Pi 供应路由 |
| [src/provider/llm/pi_adapter.ts](src/provider/llm/pi_adapter.ts) | iKi ↔ Pi 消息投影 |
| [src/message/ui_chunk_reducer.ts](src/message/ui_chunk_reducer.ts) | 流式 UI chunk 归并（含 seed） |
| [src/message/tool_payload_contracts.ts](src/message/tool_payload_contracts.ts) | renderer 可用的 payload 解码 |

## 常用命令

```sh
pnpm run ci:quality
pnpm exec vitest run <path>
```

## 改这里之前

- 根 [AGENTS.md](../../AGENTS.md) —— "Change prompt assembly" / "LLM-call surface" 起点。
- [docs/decisions/007-model-supply-layer-pi-ai.md](../../docs/decisions/007-model-supply-layer-pi-ai.md) —— 分路径切换 Pi 的决定与约束。
- [docs/harness.md](../../docs/harness.md) —— 运行时概念模型。
