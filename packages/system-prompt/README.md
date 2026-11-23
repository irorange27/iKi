# @iki/system-prompt

请求级系统提示词与人设组装包；集中拥有静态身份片段、工具规则与多槽位拼接顺序，避免各调用路径各自手工拼字符串。

## 职责

- **槽位组装**：`assembler.ts` 定义 `REQUEST_SYSTEM_PROMPT_SLOTS`（`persona -> planPrompt -> extraPrompt -> transcriptSystem`）、`SYSTEM_PROMPT_SECTION_ORDERS` 与 `assembleRequestSystemPrompt` / `assembleAuxRequestSystemPrompt`，并提供节渲染与快照格式化工具。
- **人设加载**：`persona.ts` 读取用户数据目录的 `PERSONA.md` 与静态 OS 说明产出 `getPersonaPrompt`；动态日期、时区与工作区信息由 `getRuntimeReminderText` 提供。
- **工具规则与风格**：`tool_rules.ts` 随可用工具集合动态生成 `shell`（POSIX `bash` / Windows `pwsh`）等执行规则或 `NO_TOOLS_SYSTEM_PROMPT`；`personality.ts` 提供风格选项模板。

## 拼接顺序与 KV-Cache 分工

每次主对话请求的 `systemPrompt` 由 `assembleRequestSystemPrompt` 按槽位权重升序拼成**唯一一条**头部 `role: "system"` 文本（空片段跳过，保留原文并以 `\n\n` 连接）：

| 顺序 | 槽位 / 节 | order | 内容与 Owner |
|---|---|---:|---|
| 1 | `persona` | `100` | `PERSONA.md`（或默认 `You are iKi.`）+ 静态 OS（`persona.ts`，不含日期） |
| 2 | `planPrompt` | `200` | 工具规则（`buildToolSystemPrompt`）+ 回复风格（`getPersonalityStylePrompt`，由 `execution_plan.ts` 注入） |
| 3 | `extraPrompt` | `300` | 辅助调用或额外请求指令（`assembleAuxRequestSystemPrompt` / `extraSystemPrompt`） |
| 4 | `transcriptSystem` | `400` | 由 `@iki/harness/turn_prep` 预拼的静态工作区指令，内部再按 `SYSTEM_PROMPT_SECTION_ORDERS` 排序：`project_context`（`400`，`AGENTS.md` / `AGENT.md` / `IKI.md`） → `skills`（`500`，技能元数据索引与 `skillFile` 路径） |

为了全供应商稳定命中前缀 KV 缓存，会随会话/时间变化的内容**不进入**头部 `system`：

- **动态运行态上下文**：`Current date` / 时区与当前工作区路径由 `formatPromptContextSnapshot` 包为 `<system_reminder name="runtime">`，作为 `role: "user"` 放在对话首部。
- **上下文压缩摘要**：`<compacted-summary>` checkpoint 以 `role: "user"` 挂载，消息流中段保持零 `role: "system"`。

## 边界

- 只依赖 `@iki/core`；不依赖 `@iki/harness`、`@iki/llm` 或文件系统会话状态。
- 本包只决定**如何从各 owner 的槽位文本组装与格式化**，工作区规则/Skills 检索留在 `@iki/harness/turn_prep`。

## 主要入口

| 文件 | 作用 |
|---|---|
| [src/index.ts](src/index.ts) | 公共模块重导出 |
| [src/assembler.ts](src/assembler.ts) | 槽位表、`assembleRequestSystemPrompt`、节对比工具 |
| [src/persona.ts](src/persona.ts) | `PERSONA.md` 读取与默认人设生成 |
| [src/tool_rules.ts](src/tool_rules.ts) | `buildToolSystemPrompt` 与工具使用约束 |
| [src/personality.ts](src/personality.ts) | 回复风格预设定义 |

## 常用命令

```sh
pnpm run ci:quality
pnpm exec vitest run packages/system-prompt/tests
```
