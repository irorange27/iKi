# @iki/llm-pi-ai

基于 `@earendil-works/pi-ai` 的模型供应商适配层；负责构建模型实例、消息转换、用量映射以及辅助文本生成运行时。

## 职责

- **供应商与适配器**：`factory.ts` 组装主对话/辅助调用所需的模型、系统提示词与选项；`pi_adapter.ts` 负责 `buildPiModel`、`callPiChat`、`projectHistoryToPiContext`（将内部消息映射为 `pi-ai` `Context`）与 `projectUsageToIki`。
- **模型目录与发现**：`model_discovery.ts` 与 `tool_model.ts` 处理 provider 模型列表拉取、能力合并与轻量工具模型路由。
- **辅助生成运行时**：`title_runtime.ts`（会话标题）、`catalog_selection.ts` / `catalog_selection_runtime.ts`、`skill_selection.ts`、`tool_selection.ts`、`prompt_text_generator.ts`、`prompt_context.ts`。

## 边界

- 依赖 `@iki/core`、`@iki/llm`、`@iki/store`、`@iki/system-prompt`；不感知 `thread_session` 或具体内置工具实现。
- 子路径通过 `./* -> ./src/*.ts` 导入（无 `src/index.ts`）；调用方由 `@iki/harness` 注入真实配置并驱动。

## 主要入口

| 文件 | 作用 |
|---|---|
| [src/factory.ts](src/factory.ts) | 模型与 LLM 调用工厂（主对话与辅助请求） |
| [src/pi_adapter.ts](src/pi_adapter.ts) | `@earendil-works/pi-ai` 模型/上下文/用量双向适配器 |
| [src/model_discovery.ts](src/model_discovery.ts) | 远端模型枚举与本地目录发现 |
| [src/tool_model.ts](src/tool_model.ts) | 摘要/标题等轻量辅助模型选择 |
| [src/title_runtime.ts](src/title_runtime.ts) | 会话自动命名生成 |

## 常用命令

```sh
pnpm run ci:quality
pnpm exec vitest run <path>
```
