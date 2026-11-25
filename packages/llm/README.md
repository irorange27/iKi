# @iki/llm

LLM 消息模型、UI/模型双向投影、工具负载契约与网络传输辅助层；衔接领域模型和具体供应商适配器。

## 职责

- **消息与投影**：`message/model_history.ts` 与 `model_messages.ts` 规范化历史消息与 tool-call/result 配对；`ui_messages.ts`、`ui_to_model.ts`、`ui_chunk_reducer.ts` 与 `ui_protocol.ts` 负责流式 chunk 与持久化 UI 消息互转。
- **工具负载契约**：`message/tool_parts/`（`guards`、`ids`、`interrupt`、`normalize`、`parse`）与 `tool_payload_contracts.ts` 提供无 zod 的解码原语（供上层 UI/CLI 安全消费）。
- **提示词与样式门面**：`message/system_prompt.ts` 与 `message/personality.ts` 转接 `@iki/system-prompt`；`thread_markdown_export.ts` 提供会话 Markdown 导出。
- **网络与底层类型**：`network/http.ts`、`proxy.ts` 处理超时与代理；`provider/llm/wire_types.ts` 定义跨层线协议类型。

## 边界

- 只依赖 `@iki/core` 与 `@iki/system-prompt`；不接触持久化（`@iki/store` / `@iki/session`），也不包含具体的 `@earendil-works/pi-ai` vendor 适配（该部分在 `@iki/llm-pi-ai`）。
- 导出子路径通过 `./* -> ./src/*.ts` 暴露，没有根 `./src/index.ts` barrel。

## 主要入口

| 文件 | 作用 |
|---|---|
| [src/message/model_history.ts](src/message/model_history.ts) | 工具结果归一化（`normalizeToolOutput` / `toolResultText`）与历史辅助 |
| [src/message/model_messages.ts](src/message/model_messages.ts) | `sanitizeModelConversationMessages` 工具配对校验 |
| [src/message/ui_messages.ts](src/message/ui_messages.ts) | UI 消息构造、工具状态归并与模型消息转换 |
| [src/message/tool_payload_contracts.ts](src/message/tool_payload_contracts.ts) | 渲染侧安全工具负载解码契约 |
| [src/provider/llm/wire_types.ts](src/provider/llm/wire_types.ts) | `SharedV3ProviderOptions` / `JSONValue` 等通用 wire 类型 |

## 常用命令

```sh
pnpm run ci:quality
pnpm exec vitest run <path>
```
