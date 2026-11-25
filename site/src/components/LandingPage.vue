<script setup lang="ts">
import { ArrowRight, Check, Copy } from '@lucide/vue';
import { computed, ref } from 'vue';
import type { Locale } from '../data/types';
import ArchitectureMap from './ArchitectureMap.vue';
import InteractiveWorkbench from './InteractiveWorkbench.vue';

const props = defineProps<{
  locale: Locale;
}>();

const emit = defineEmits<{
  navigate: [hash: string];
}>();

const installMode = ref<'npm' | 'npx' | 'source'>('npm');
const copied = ref(false);

const installCommand = computed(() => {
  if (installMode.value === 'npm') return 'npm install -g @irorange27/iki && iki';
  if (installMode.value === 'npx') return 'npx @irorange27/iki';
  return 'git clone https://github.com/irorange27/iKi.git && cd iKi && pnpm install && pnpm cli';
});

const copyInstall = async () => {
  try {
    await navigator.clipboard.writeText(installCommand.value);
    copied.value = true;
    window.setTimeout(() => {
      copied.value = false;
    }, 1800);
  } catch {
    /* ignore clipboard permission errors */
  }
};

const copy = computed(() =>
  props.locale === 'zh'
    ? {
        eyebrow: 'AGENT HARNESS · NODE 24 · TYPESCRIPT',
        h1: '为 KV-Cache 纪律与可观测执行而生的 Agent Harness。',
        lead: '将顶层工具冻结为 3 个核心原语，用 TypeScript MCP Code Mode + PTC 沙箱替代 Schema 轰炸，并在终端里实时看清每个 git-worktree Worker 与后台任务。',
        ctaDocs: '阅读完整文档',
        ctaCli: 'CLI 命令参考',
        ch1Num: '01',
        ch1Title: 'KV-Cache 原生上下文布局',
        ch1Body:
          '系统提示词与 3 个顶层工具（bash/pwsh、job、ptc）跨轮次字节冻结；工作区、技能与 MCP 变更以锚定在 user 消息前的 <system_reminder> 增量注入，绝不篡改已缓存前缀。',
        ch2Num: '02',
        ch2Title: 'MCP Code Mode + TypeScript PTC 沙箱',
        ch2Body:
          '不再每轮塞入几十个原始 JSON Schema。iKi 将 MCP 工具编译为紧凑的 TypeScript 声明，按 L0 摘要 → L1 mcp.describe() → L2 node:vm 沙箱脚本渐进披露，一轮内 Promise.all 并发聚合结果。',
        ch3Num: '03',
        ch3Title: '实时可观测的多 Agent Swarm 与后台任务',
        ch3Body:
          '按需拉起 git worktree 隔离的并行 Worker，协调者用强模型、Worker 用快模型；通过底部实时活动条与 Ctrl+W / Ctrl+J 全屏看板，随时追踪工具流、共享消息板与持久化后台日志。',
        archTitle: '严格单向依赖的 13 包 Monorepo',
        archSub: '点击任意模块查看其职责与允许依赖方向，每次提交均由 dependency-cruiser 与 knip 校验。',
        nextTitle: '从文档开始深入了解',
        nextItems: [
          { slug: 'getting-started', title: '快速开始与零配置引导', desc: '安装、环境变量自动识别、iki setup 与自更新。' },
          { slug: 'cli-reference', title: '完整 CLI 与斜杠命令参考', desc: '全部启动参数、快捷键与 /mcp /swarm /jobs 命令。' },
          { slug: 'mcp-code-mode', title: 'MCP Code Mode 与 PTC 指南', desc: 'L0/L1/L2 渐进披露、.d.ts 编译与 mcp.json 导入。' },
          { slug: 'swarm-and-jobs', title: 'Swarm 编排与持久化任务', desc: 'worktree 隔离、角色模型路由与实时监控视图。' },
        ],
      }
    : {
        eyebrow: 'AGENT HARNESS · NODE 24 · TYPESCRIPT',
        h1: 'An agent harness built for KV-cache discipline, not context bloat.',
        lead: 'Freeze the top-level tool surface to 3 core primitives, replace raw MCP JSON Schema dumps with TypeScript Code Mode in a PTC sandbox, and watch git-worktree workers live in your terminal.',
        ctaDocs: 'Read the Docs',
        ctaCli: 'CLI Reference',
        ch1Num: '01',
        ch1Title: 'KV-Cache-First Context Layout',
        ch1Body:
          'The static system prompt and 3 top-level core tools (bash/pwsh, job, ptc) stay byte-identical across turns. Dynamic workspace, skill, and MCP updates land as anchored <system_reminder> deltas without invalidating earlier cache prefixes.',
        ch2Num: '02',
        ch2Title: 'MCP Code Mode + TypeScript PTC Sandbox',
        ch2Body:
          'Stop dumping 50 raw JSON Schemas into every request. iKi compiles MCP tools into compact TypeScript declarations — disclosed progressively from a 748-char L0 index to on-demand mcp.describe() and 1-turn Promise.all execution inside a zero-dep Node 24 node:vm sandbox.',
        ch3Num: '03',
        ch3Title: 'Live-Observable Swarm & Durable Jobs',
        ch3Body:
          'Run parallel workers inside isolated git worktrees with role-based model routing (frontier coordinator + fast workers). Track live tool calls, shared board deltas, and timeout-promoted background jobs with Ctrl+W and Ctrl+J.',
        archTitle: 'A 13-Package Monorepo With Hard Boundaries',
        archSub: 'Click any package to inspect its scope and allowed one-way dependencies, enforced by dependency-cruiser and knip.',
        nextTitle: 'Explore the Documentation',
        nextItems: [
          { slug: 'getting-started', title: 'Getting Started & Onboarding', desc: 'Install, zero-config env auto-detection, iki setup, and self-update.' },
          { slug: 'cli-reference', title: 'CLI Flags, Shortcuts & Commands', desc: 'Full reference for flags, keybindings, and /mcp, /swarm, /jobs.' },
          { slug: 'mcp-code-mode', title: 'MCP Code Mode & PTC Sandbox', desc: 'L0/L1/L2 progressive disclosure, .d.ts compilation, and mcp.json import.' },
          { slug: 'swarm-and-jobs', title: 'Multi-Agent Swarm & Durable Jobs', desc: 'Worktree isolation, role-based models, and live watch overlays.' },
        ],
      }
);
</script>

<template>
  <div>
    <!-- Asymmetric Hero Band -->
    <section class="drafting-surface border-b border-[var(--border)]">
      <div class="mx-auto grid max-w-[1220px] items-start gap-10 px-5 py-14 sm:px-8 lg:grid-cols-12 lg:gap-12 lg:py-20">
        <!-- Left editorial thesis -->
        <div class="reveal lg:col-span-5">
          <div class="font-mono text-[11.5px] font-medium tracking-wider text-[var(--accent)]">
            {{ copy.eyebrow }}
          </div>
          <h1
            class="mt-4 font-display font-bold leading-[1.08] text-[var(--fg)]"
            style="font-size: clamp(2.15rem, 3.8vw, 3.35rem)"
          >
            {{ copy.h1 }}
          </h1>
          <p class="mt-5 max-w-[56ch] text-[16px] leading-[1.68] text-[var(--fg-muted)]">
            {{ copy.lead }}
          </p>

          <!-- Install command switcher -->
          <div class="mt-7 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-elevated)] p-2">
            <div class="mb-2 flex items-center justify-between px-1">
              <div class="flex gap-1 font-mono text-[11.5px]">
                <button
                  v-for="mode in (['npm', 'npx', 'source'] as const)"
                  :key="mode"
                  type="button"
                  class="cursor-pointer rounded px-2 py-0.5 transition-colors"
                  :class="
                    installMode === mode
                      ? 'bg-[var(--accent-soft)] text-[var(--fg)] font-semibold'
                      : 'text-[var(--fg-muted)] hover:text-[var(--fg)]'
                  "
                  @click="installMode = mode"
                >
                  {{ mode }}
                </button>
              </div>
              <span class="font-mono text-[11px] text-[var(--fg-faint)]">Node 24+</span>
            </div>

            <div class="flex items-center justify-between gap-2 rounded-md border border-[var(--border)] bg-[var(--bg-subtle)] px-3 py-2">
              <code class="overflow-x-auto whitespace-nowrap text-[12.5px] text-[var(--fg)]">
                {{ installCommand }}
              </code>
              <button
                type="button"
                class="inline-flex shrink-0 cursor-pointer items-center gap-1 rounded border border-[var(--border)] bg-[var(--bg-elevated)] px-2 py-1 font-mono text-[11px] text-[var(--fg-muted)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--fg)]"
                @click="copyInstall"
              >
                <Check v-if="copied" class="h-3.5 w-3.5 text-[var(--ok)]" />
                <Copy v-else class="h-3.5 w-3.5" />
                <span>{{ copied ? (locale === 'zh' ? '已复制' : 'Copied') : (locale === 'zh' ? '复制' : 'Copy') }}</span>
              </button>
            </div>
          </div>

          <!-- Primary & secondary actions -->
          <div class="mt-6 flex flex-wrap items-center gap-3">
            <a
              href="#/docs/getting-started"
              class="inline-flex items-center gap-2 rounded-md bg-[var(--accent)] px-4 py-2.5 text-[14px] font-semibold text-[var(--accent-ink)] no-underline transition-colors hover:bg-[var(--accent-strong)]"
              @click.prevent="emit('navigate', '#/docs/getting-started')"
            >
              <span>{{ copy.ctaDocs }}</span>
              <ArrowRight class="h-4 w-4" />
            </a>
            <a
              href="#/docs/cli-reference"
              class="inline-flex items-center gap-2 rounded-md border border-[var(--border-strong)] bg-[var(--bg-elevated)] px-4 py-2.5 text-[14px] font-medium text-[var(--fg)] no-underline transition-colors hover:bg-[var(--bg-subtle)]"
              @click.prevent="emit('navigate', '#/docs/cli-reference')"
            >
              {{ copy.ctaCli }}
            </a>
          </div>
        </div>

        <!-- Right interactive workbench -->
        <div class="reveal reveal-delay-1 lg:col-span-7">
          <InteractiveWorkbench :locale="locale" />
        </div>
      </div>
    </section>

    <!-- Chapter 01: KV-Cache Discipline (Asymmetric 5/7) -->
    <section class="border-b border-[var(--border)]">
      <div class="mx-auto grid max-w-[1220px] gap-10 px-5 py-16 sm:px-8 lg:grid-cols-12 lg:py-24">
        <div class="lg:col-span-5">
          <span class="font-mono text-[12px] font-semibold text-[var(--accent)]">{{ copy.ch1Num }}</span>
          <h2 class="mt-2 font-display text-[clamp(1.6rem,2.6vw,2.15rem)] font-bold leading-tight text-[var(--fg)]">
            {{ copy.ch1Title }}
          </h2>
          <p class="mt-4 text-[15.5px] leading-[1.7] text-[var(--fg-muted)]">
            {{ copy.ch1Body }}
          </p>
          <a
            href="#/docs/kv-cache-and-context"
            class="mt-5 inline-flex items-center gap-1.5 text-[14px] font-semibold text-[var(--accent)] no-underline hover:underline"
            @click.prevent="emit('navigate', '#/docs/kv-cache-and-context')"
          >
            <span>{{ locale === 'zh' ? '查看 KV-Cache 不变量文档' : 'Read KV-Cache invariants' }}</span>
            <ArrowRight class="h-3.5 w-3.5" />
          </a>
        </div>

        <div class="lg:col-span-7">
          <div class="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)]">
            <table class="w-full border-collapse text-left text-[13.5px]">
              <thead>
                <tr class="border-b border-[var(--border)] bg-[var(--bg-subtle)]">
                  <th class="px-4 py-3 font-mono text-[11.5px] uppercase tracking-wider text-[var(--fg-faint)]">
                    {{ locale === 'zh' ? '维度' : 'Dimension' }}
                  </th>
                  <th class="px-4 py-3 font-mono text-[11.5px] uppercase tracking-wider text-[var(--fg-faint)]">
                    {{ locale === 'zh' ? '常见 Agent / 原生 MCP' : 'Typical Agent / Raw MCP' }}
                  </th>
                  <th class="px-4 py-3 font-mono text-[11.5px] uppercase tracking-wider text-[var(--accent)]">
                    iKi
                  </th>
                </tr>
              </thead>
              <tbody class="divide-y divide-[var(--border)]">
                <tr>
                  <td class="px-4 py-3.5 font-medium text-[var(--fg)]">
                    {{ locale === 'zh' ? 'MCP 上下文占用' : 'MCP Context Cost' }}
                  </td>
                  <td class="px-4 py-3.5 text-[var(--fg-muted)]">
                    {{ locale === 'zh' ? '每轮注入全部 JSON Schema' : 'Full JSON Schema sent every turn' }}
                  </td>
                  <td class="px-4 py-3.5 font-medium text-[var(--fg)]">
                    {{ locale === 'zh' ? '紧凑 TS 签名 + 增量锚定（10 工具仅 748 字符）' : 'Compact TS signatures + anchored delta (748 chars / 10 tools)' }}
                  </td>
                </tr>
                <tr>
                  <td class="px-4 py-3.5 font-medium text-[var(--fg)]">
                    {{ locale === 'zh' ? '多工具编排' : 'Multi-Tool Chaining' }}
                  </td>
                  <td class="px-4 py-3.5 text-[var(--fg-muted)]">
                    {{ locale === 'zh' ? '每轮串行调 1 个工具，大响应污染历史' : 'Sequential round-trips; raw outputs bloat history' }}
                  </td>
                  <td class="px-4 py-3.5 font-medium text-[var(--fg)]">
                    {{ locale === 'zh' ? 'ptc 沙箱 Promise.all 并发 + 脚本本地过滤' : 'ptc sandbox Promise.all + local filtering in 1 turn' }}
                  </td>
                </tr>
                <tr>
                  <td class="px-4 py-3.5 font-medium text-[var(--fg)]">
                    {{ locale === 'zh' ? '前缀缓存稳定' : 'Prefix Stability' }}
                  </td>
                  <td class="px-4 py-3.5 text-[var(--fg-muted)]">
                    {{ locale === 'zh' ? '动态时间戳/变化工具列表击穿缓存' : 'Mutating prompts & tool arrays bust cache' }}
                  </td>
                  <td class="px-4 py-3.5 font-medium text-[var(--fg)]">
                    {{ locale === 'zh' ? '静态 systemPrompt + 冻结 3 工具 + sessionId 亲和' : 'Frozen systemPrompt + 3 static tools + sessionId affinity' }}
                  </td>
                </tr>
                <tr>
                  <td class="px-4 py-3.5 font-medium text-[var(--fg)]">
                    {{ locale === 'zh' ? '多 Agent 观测' : 'Swarm Visibility' }}
                  </td>
                  <td class="px-4 py-3.5 text-[var(--fg-muted)]">
                    {{ locale === 'zh' ? '黑盒等待或手工切 tmux' : 'Opaque subagents or manual tmux panes' }}
                  </td>
                  <td class="px-4 py-3.5 font-medium text-[var(--fg)]">
                    {{ locale === 'zh' ? 'git worktree 隔离 + 实时活动条 + Ctrl+W/J 看板' : 'git worktree isolation + live strip + Ctrl+W / Ctrl+J views' }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>

    <!-- Chapter 02: MCP Code Mode (Reversed Asymmetric 7/5) -->
    <section class="border-b border-[var(--border)] bg-[var(--bg-subtle)]">
      <div class="mx-auto grid max-w-[1220px] items-center gap-10 px-5 py-16 sm:px-8 lg:grid-cols-12 lg:py-24">
        <div class="order-2 lg:order-1 lg:col-span-7">
          <div class="grid gap-3 sm:grid-cols-3">
            <div class="rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] p-4">
              <div class="font-mono text-[11px] font-semibold text-[var(--accent)]">L0 · INDEX</div>
              <p class="mt-2 text-[13.5px] leading-relaxed text-[var(--fg-muted)]">
                {{
                  locale === 'zh'
                    ? '小服务内联单行 TS 签名；大服务仅列出工具名 + describe 提示。未变更轮次 0 重复。'
                    : 'Compact inline TS signatures for small servers; name index + describe hint for large ones. Zero repeat on unchanged turns.'
                }}
              </p>
            </div>
            <div class="rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] p-4">
              <div class="font-mono text-[11px] font-semibold text-[var(--accent)]">L1 · .D.TS</div>
              <p class="mt-2 text-[13.5px] leading-relaxed text-[var(--fg-muted)]">
                {{
                  locale === 'zh'
                    ? '按需调用 mcp.describe(server) 或 /mcp dts，实时将 JSON Schema 编译为标准 TypeScript 命名空间。'
                    : 'Inspect declare namespace mcp.<server> on demand via mcp.describe() or /mcp dts — 5–10× denser than raw JSON Schema.'
                }}
              </p>
            </div>
            <div class="rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] p-4">
              <div class="font-mono text-[11px] font-semibold text-[var(--accent)]">L2 · PTC VM</div>
              <p class="mt-2 text-[13.5px] leading-relaxed text-[var(--fg-muted)]">
                {{
                  locale === 'zh'
                    ? '基于 Node 24 原生 stripTypeScriptTypes + node:vm 隔离执行，自动归一化返回 { content, text, data? }。'
                    : 'Isolated node:vm sandbox using Node 24 native stripTypeScriptTypes with normalized { content, text, data? } returns.'
                }}
              </p>
            </div>
          </div>
        </div>

        <div class="order-1 lg:order-2 lg:col-span-5">
          <span class="font-mono text-[12px] font-semibold text-[var(--accent)]">{{ copy.ch2Num }}</span>
          <h2 class="mt-2 font-display text-[clamp(1.6rem,2.6vw,2.15rem)] font-bold leading-tight text-[var(--fg)]">
            {{ copy.ch2Title }}
          </h2>
          <p class="mt-4 text-[15.5px] leading-[1.7] text-[var(--fg-muted)]">
            {{ copy.ch2Body }}
          </p>
          <a
            href="#/docs/mcp-code-mode"
            class="mt-5 inline-flex items-center gap-1.5 text-[14px] font-semibold text-[var(--accent)] no-underline hover:underline"
            @click.prevent="emit('navigate', '#/docs/mcp-code-mode')"
          >
            <span>{{ locale === 'zh' ? '深入 MCP Code Mode 与 PTC' : 'Explore MCP Code Mode' }}</span>
            <ArrowRight class="h-3.5 w-3.5" />
          </a>
        </div>
      </div>
    </section>

    <!-- Chapter 03: Swarm & Durable Jobs (Asymmetric 5/7) -->
    <section class="border-b border-[var(--border)]">
      <div class="mx-auto grid max-w-[1220px] items-center gap-10 px-5 py-16 sm:px-8 lg:grid-cols-12 lg:py-24">
        <div class="lg:col-span-5">
          <span class="font-mono text-[12px] font-semibold text-[var(--accent)]">{{ copy.ch3Num }}</span>
          <h2 class="mt-2 font-display text-[clamp(1.6rem,2.6vw,2.15rem)] font-bold leading-tight text-[var(--fg)]">
            {{ copy.ch3Title }}
          </h2>
          <p class="mt-4 text-[15.5px] leading-[1.7] text-[var(--fg-muted)]">
            {{ copy.ch3Body }}
          </p>
          <a
            href="#/docs/swarm-and-jobs"
            class="mt-5 inline-flex items-center gap-1.5 text-[14px] font-semibold text-[var(--accent)] no-underline hover:underline"
            @click.prevent="emit('navigate', '#/docs/swarm-and-jobs')"
          >
            <span>{{ locale === 'zh' ? '阅读 Swarm 与后台任务指南' : 'Read Swarm & Jobs guide' }}</span>
            <ArrowRight class="h-3.5 w-3.5" />
          </a>
        </div>

        <div class="lg:col-span-7">
          <div class="divide-y divide-[var(--border)] rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)]">
            <div class="flex flex-col justify-between gap-2 p-4 sm:flex-row sm:items-center">
              <div>
                <div class="font-mono text-[13px] font-semibold text-[var(--fg)]">workspace: "share" (git worktree)</div>
                <div class="mt-0.5 text-[13.5px] text-[var(--fg-muted)]">
                  {{ locale === 'zh' ? '共享底层 .git 对象库、独立分支与工作目录，并行修改互不踩踏。' : 'Shared .git object store with an isolated branch and working copy per worker.' }}
                </div>
              </div>
              <span class="shrink-0 rounded-full bg-[var(--ok-soft)] px-2.5 py-0.5 font-mono text-[11px] font-medium text-[var(--ok)]">
                {{ locale === 'zh' ? '默认写隔离' : 'default for writers' }}
              </span>
            </div>
            <div class="flex flex-col justify-between gap-2 p-4 sm:flex-row sm:items-center">
              <div>
                <div class="font-mono text-[13px] font-semibold text-[var(--fg)]">Ctrl+W · Live Swarm Watch</div>
                <div class="mt-0.5 text-[13.5px] text-[var(--fg-muted)]">
                  {{ locale === 'zh' ? '随时切换查看每个 Worker 的实时工具调用、思考流与共享消息板增量。' : 'Switch into any worker live stream or the shared message board without leaving the TUI.' }}
                </div>
              </div>
              <kbd class="shrink-0 rounded border border-[var(--border-strong)] bg-[var(--bg-subtle)] px-2 py-0.5 font-mono text-[11.5px] text-[var(--fg)]">Ctrl+W</kbd>
            </div>
            <div class="flex flex-col justify-between gap-2 p-4 sm:flex-row sm:items-center">
              <div>
                <div class="font-mono text-[13px] font-semibold text-[var(--fg)]">Ctrl+J / Ctrl+K · Durable Background Jobs</div>
                <div class="mt-0.5 text-[13.5px] text-[var(--fg-muted)]">
                  {{ locale === 'zh' ? '超时自动转后台持久化运行，支持实时 tail 日志与一键终止进程组。' : 'Long-running commands auto-promote on timeout with live log tailing and process-group kill.' }}
                </div>
              </div>
              <kbd class="shrink-0 rounded border border-[var(--border-strong)] bg-[var(--bg-subtle)] px-2 py-0.5 font-mono text-[11.5px] text-[var(--fg)]">Ctrl+J</kbd>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- Architecture Blueprint Band -->
    <section class="border-b border-[var(--border)] bg-[var(--bg-subtle)]">
      <div class="mx-auto max-w-[1220px] px-5 py-16 sm:px-8 lg:py-24">
        <div class="mb-8 max-w-[64ch]">
          <h2 class="font-display text-[clamp(1.6rem,2.6vw,2.15rem)] font-bold text-[var(--fg)]">
            {{ copy.archTitle }}
          </h2>
          <p class="mt-2.5 text-[15px] text-[var(--fg-muted)]">
            {{ copy.archSub }}
          </p>
        </div>
        <ArchitectureMap :locale="locale" />
      </div>
    </section>

    <!-- Docs Directory Strip -->
    <section>
      <div class="mx-auto max-w-[1220px] px-5 py-16 sm:px-8 lg:py-20">
        <h2 class="font-display text-[clamp(1.4rem,2.2vw,1.8rem)] font-bold text-[var(--fg)]">
          {{ copy.nextTitle }}
        </h2>
        <div class="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <a
            v-for="item in copy.nextItems"
            :key="item.slug"
            :href="`#/docs/${item.slug}`"
            class="group flex flex-col justify-between rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] p-5 no-underline transition-colors hover:border-[var(--accent)]"
            @click.prevent="emit('navigate', `#/docs/${item.slug}`)"
          >
            <div>
              <div class="font-display text-[15.5px] font-semibold text-[var(--fg)] group-hover:text-[var(--accent)]">
                {{ item.title }}
              </div>
              <p class="mt-2 text-[13.5px] leading-relaxed text-[var(--fg-muted)]">
                {{ item.desc }}
              </p>
            </div>
            <div class="mt-4 inline-flex items-center gap-1 font-mono text-[12px] text-[var(--accent)]">
              <span>{{ locale === 'zh' ? '阅读' : 'Read' }}</span>
              <ArrowRight class="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
            </div>
          </a>
        </div>
      </div>
    </section>
  </div>
</template>
