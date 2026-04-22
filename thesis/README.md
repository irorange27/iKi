# Thesis Workspace

这个目录使用 Typst Universe 上的 `modern-shu-thesis` 模板来承载毕业论文初稿。

官方模板页面：

- [modern-shu-thesis](https://typst.app/universe/package/modern-shu-thesis/)

当前采用的模板版本：

- `@preview/modern-shu-thesis:0.3.3`
- Typst Universe 页面显示该版本发布日期为 `2025-04-22`

## 目录结构

- `thesis.typ`
  - 论文主入口
- `chapters/`
  - 六章正文草稿
- `ref.bib`
  - 参考文献

## 编译方法

在本目录下执行：

```bash
typst compile thesis.typ
```

如果你想指定输出文件：

```bash
typst compile thesis.typ thesis.pdf
```

我已经在本地验证过该命令可以成功生成 PDF。

## 当前已完成内容

- 将“基于Agent的桌面宠物交互系统”作为备案题目写入论文封面信息
- 按六章结构拆分为独立章节文件
- 把仓库中的论文主线、系统设计和实验设计材料迁移为 Typst 初稿
- 预留了摘要、实验结果、致谢中的后续回填位置

## 你接下来需要补的个人信息

请优先修改 [thesis.typ](/Users/nina/Developer/MyRepo/iki/thesis/thesis.typ) 中的以下字段：

- `school`
- `major`
- `student_id`
- `name`
- `supervisor`
- `date`

## 说明

当前正文已经尽量贴合仓库中的真实实现与研究资产，主要依据这些材料整理：

- [desktop-pet-affect-thesis-outline.md](/Users/nina/Developer/MyRepo/iki/docs/design/desktop-pet-affect-thesis-outline.md)
- [desktop-pet-affect-thesis-six-chapter-catalog.md](/Users/nina/Developer/MyRepo/iki/docs/design/desktop-pet-affect-thesis-six-chapter-catalog.md)
- [emotion-system-integration.md](/Users/nina/Developer/MyRepo/iki/docs/design/emotion-system-integration.md)
- [affect-aware-intervention-policy.md](/Users/nina/Developer/MyRepo/iki/docs/design/affect-aware-intervention-policy.md)
- [paper-sections-dataset-and-experiments.md](/Users/nina/Developer/MyRepo/iki/research/affect-thesis/paper-sections-dataset-and-experiments.md)

第 5 章中的实验设计已经可直接继续写，但“结果数值”和“结果表格”仍需要在正式跑表后回填。

## 字体说明

在当前这台 macOS 机器上，`typst compile thesis.typ` 可以成功生成 PDF，但模板会提示缺少 `simsun`、`simhei`、`stsongti` 等字体家族。这是模板默认采用 Windows 常见中文字体命名造成的，不影响初稿继续写作，但可能导致封面和正文字体回退到系统默认字体。

如果你后面要出正式版 PDF，建议二选一：

- 在系统里安装与模板兼容的宋体/黑体字体
- 基于模板源码单独做一份本地字体映射版
