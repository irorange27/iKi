#import "@preview/modern-shu-thesis:0.3.3": documentclass

#let (
  info,
  doc,
  cover,
  declare,
  outline,
  mainmatter,
  abstract,
  bib,
  acknowledgement,
  under-cover,
) = documentclass(
  info: (
    title: "基于Agent的桌面宠物交互系统设计与实现",
    school: "计算机工程与科学学院",
    major: "计算机科学与技术",
    student_id: "待填写",
    name: "待填写",
    supervisor: "待填写",
    date: "2026年5月",
  ),
)

#show: doc

#cover()
#declare()

#abstract(
  keywords: ("桌面宠物", "Agent", "情感感知", "干预策略", "Typst"),
  keywords-en: ("desktop pet", "agent", "affect-aware policy", "intervention policy", "Typst"),
)[
  随着大语言模型与智能体系统的快速发展，桌面端智能助手正逐步从单轮问答工具演化为具备持续记忆、任务执行与状态反馈能力的 personal agent。然而，现有系统往往侧重生产力能力或陪伴体验中的单一方向：前者强调任务完成效率，却容易忽视用户在真实工作场景中的情绪波动与脆弱性状态；后者注重情感表达，却缺少稳定、可审计的任务协同机制。围绕这一问题，本文设计并实现了一套基于 Agent 的桌面宠物交互系统，并重点研究情感感知信号如何以显式策略层的形式进入智能体决策过程。

  本文首先给出系统的需求分析与总体架构设计，将系统划分为感知、状态建模、决策、执行与外显反馈五个层次。在此基础上，本文提出一种面向持续存在型智能体的情感感知驱动干预策略机制：系统不将情绪识别结果仅用于回复语气修饰，而是将其建模为带不确定性的用户状态信号，并结合任务上下文、记忆检索结果与运行时配置，决定当前轮对话应采用的干预模式。为支持这一机制，系统实现了 affect 状态聚合、上下文组装、工具与技能路由控制、情绪相关工具 guardrail，以及桌面宠物 companion 外显反馈等关键模块。

  为验证该机制的可研究性与可复现性，本文进一步构建了一套面向情绪与任务纠缠场景的受控 benchmark，并设计了 `no_affect`、`tone_only` 与 `explicit_policy` 三种运行条件的对比实验框架。论文同时保留中性生产力任务对照集，用于检验情感感知策略是否会对普通任务辅助能力造成明显损害。当前初稿已完成论文结构、系统实现叙事与实验设计框架的统一整理，为后续实验跑表、结果分析与定稿提供了稳定的 Typst 写作基础。
][
  With the rapid development of large language models and agent systems, desktop assistants are evolving from single-turn chat tools into persistent personal agents with memory, task execution, and visible runtime feedback. However, existing systems usually emphasize either productivity or companionship alone. Productivity-oriented agents focus on task completion, but often ignore the user's affective state in real working scenarios. Companion-oriented systems, in contrast, emphasize emotional expression while lacking a stable and auditable mechanism for task collaboration. To address this gap, this thesis designs and implements an agent-based desktop pet interaction system, and studies how affect signals can be elevated from prompt decoration to an explicit intervention policy.

  The thesis first presents the requirement analysis and overall architecture of the system. The runtime is organized into five stages: perception, state modeling, decision, execution, and external feedback. On top of this architecture, the thesis proposes an affect-aware intervention mechanism for persistent agents. Instead of using emotion recognition only to soften response tone, the system treats affect as an uncertain user-state signal. Combined with task context, memory retrieval, and runtime configuration, this signal determines the appropriate intervention mode for each turn. To support this mechanism, the system implements affect aggregation, structured context assembly, tool and skill routing control, affect-based guardrails, and a desktop companion layer that visualizes internal policy states.

  To make the research question measurable and reproducible, the thesis also constructs a controlled benchmark for affect-task entangled scenarios and defines a three-condition comparison framework with `no_affect`, `tone_only`, and `explicit_policy`. A neutral productivity set is retained to test whether explicit affect-aware policy harms ordinary assistance performance. The current draft has integrated the paper structure, system implementation narrative, and experiment design into a Typst-based writing workspace, providing a stable foundation for later result insertion and final revision.
]

#outline()
#show: mainmatter

#include "chapters/ch01-introduction.typ"
#include "chapters/ch02-related-work.typ"
#include "chapters/ch03-requirements-and-architecture.typ"
#include "chapters/ch04-mechanism-and-implementation.typ"
#include "chapters/ch05-experiments.typ"
#include "chapters/ch06-conclusion.typ"

#bib(bibfunc: bibliography("ref.bib"))

#acknowledgement(location: "上海大学")[
  本部分暂作为占位。正式定稿时，建议在此处感谢导师、课题组同学、参与测试与讨论的朋友，以及在系统实现和论文写作过程中提供帮助的人员。致谢内容应真实、克制，并避免与他人论文中的致谢文本重复。
]

#under-cover()
