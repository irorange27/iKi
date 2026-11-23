# @iki/tools

iKi 的插件化内置工具包，基于 `@iki/agent` 的 `BaseTool` / `ToolRegistry` 契约实现，按能力域组织子模块，通过依赖注入接入宿主（`@iki/harness`）。

## 目录结构

```
src/
├── index.ts          # 统一导出入口
└── shell/            # 终端与 Durable 后台任务插件
    ├── index.ts      # registerShellTools / createShellTools / 工具与任务导出
    ├── schema.ts     # bash/pwsh 与 job 的 Zod 输入 schema
    ├── jobs.ts       # 文件级 Durable 进程运行器、增量日志读取与进程组终止
    └── tools.ts      # BashExecutionTool / PwshExecutionTool / JobControlTool
```

## 插件化装配与配置（`[tools.shell]`）

工具本身不直接读取全局配置或工作区状态，由宿主在注册时注入：

- `getSettings?: () => ShellToolSettings`：对应 `~/.iki/settings.toml` 中的 `[tools.shell]` 段（默认由 `@iki/core/domain/settings` 的 `ShellToolSettingsSchema` 提供）：
  - `defaultTimeoutMs`（默认 `30000`）：前台等待超时
  - `maxTimeoutMs`（默认 `600000`）：单次调用允许的最大超时上限
  - `promoteOnTimeout`（默认 `true`）：超时后自动转为后台 Durable 任务而非杀进程
  - `maxOutputBytes`（默认 `24000`）与 `maxOutputLines`（默认 `200`）：模型回传的尾部输出上限
  - `defaultWaitMs`（默认 `15000`）与 `maxWaitMs`（默认 `120000`）：`job(action="wait")` 等待上限
  - `shellPath`（默认 `""`）：可选覆盖 `bash` / `pwsh` 可执行路径
- `resolveCwd?: (cwd?: string) => Promise<string>`：解析命令工作目录（默认回退到 `process.cwd()`）。

## 依赖边界

- 仅依赖 `@iki/core`、`@iki/agent` 与 `zod`。
- 严禁反向依赖 `@iki/store`、`@iki/session`、`@iki/llm`、`@iki/harness`、`@iki/cli`、`@iki/desktop`（由 `.dependency-cruiser.cjs` 门禁强制检查）。

## 常用命令

```sh
pnpm exec vitest run packages/tools/tests
```
