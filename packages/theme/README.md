# @iki/theme

主题预设、base46 编译与主题编辑器逻辑；纯 TypeScript，不认识 Electron 与 Vue。

## 职责

- **预设**：`builtins.ts` 提供内置 base46 预设、默认主题 id 与默认配置；`registry.ts` 负责注册、选择与回退到默认预设。
- **base46**：`base46_schema.ts` 校验输入，`base46_compile.ts` 把文档编译成 `--theme-*` 之类的 token。
- **编辑器**：`theme_creator.ts` / `theme_editor.ts` 从 simple / advanced seed 生成主题，`color_utils.ts` 做颜色换算，`types.ts` 定义形状。
- 统一出口是 [src/index.ts](src/index.ts)（barrel + 显式重导出）。

## 边界

- 不依赖任何 workspace 包，也不碰 IPC、renderer 组件、文件系统。
- renderer 侧消费在 `@iki/desktop`（`useThemePresetGallery.ts`、`ThemeEditorModal.vue` 等）；主题色必须走 CSS 变量 / token，别在组件里硬编码。
- 样式所有权见 [docs/conventions.md](../../docs/conventions.md) 的 Renderer conventions（theme tokens、light/dark、z-index 阶梯）。

## 主要入口

| 文件 | 作用 |
|---|---|
| [src/index.ts](src/index.ts) | 公共出口 |
| [src/registry.ts](src/registry.ts) | 预设注册与解析 |
| [src/builtins.ts](src/builtins.ts) | 内置预设与默认配置 |
| [src/base46_schema.ts](src/base46_schema.ts) | 预设输入校验 |
| [src/base46_compile.ts](src/base46_compile.ts) | token 编译 |

## 常用命令

```sh
pnpm run ci:quality
pnpm exec vitest run <path>
```

## 改这里之前

- 根 [AGENTS.md](../../AGENTS.md)。
- [docs/conventions.md](../../docs/conventions.md) —— 主题 token 与样式所有权约定。
