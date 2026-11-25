<script setup lang="ts">
import { ref } from 'vue';
import type { Locale } from '../data/types';

defineProps<{
  locale: Locale;
}>();

type PkgInfo = {
  id: string;
  layer: 'shell' | 'composition' | 'runtime' | 'leaf';
  role: Record<Locale, string>;
  deps: string[];
};

const packages: PkgInfo[] = [
  {
    id: '@iki/cli',
    layer: 'shell',
    role: {
      en: 'Fullscreen pi-tui REPL, live Swarm/Jobs watch views, zero-config onboarding, self-update, and standalone zero-dep npm bundle (@irorange27/iki).',
      zh: '基于 pi-tui 的全屏终端 TUI、实时 Swarm/Jobs 看板、零配置引导、自更新与零依赖独立 npm 包（@irorange27/iki）。',
    },
    deps: ['@iki/harness', '@iki/tools', '@iki/store', '@iki/core'],
  },
  {
    id: '@iki/desktop',
    layer: 'shell',
    role: {
      en: 'Thin macOS Electron + Vue 3 shell (main / preload / renderer) sharing the exact same harness runtime and session files.',
      zh: '薄壳 macOS Electron + Vue 3 桌面端，与 CLI 共享同一套 Harness 运行时与本地会话日志。',
    },
    deps: ['@iki/harness', '@iki/theme', '@iki/core'],
  },
  {
    id: '@iki/harness',
    layer: 'composition',
    role: {
      en: 'Composition root: thread_session, turn_prep, MCP Code Mode manager & delta anchors, git-worktree Swarm coordinator, and host tool wiring.',
      zh: '组合根：负责 thread_session、turn_prep、MCP Code Mode 管理与增量锚定、git-worktree Swarm 协调器及宿主工具注入。',
    },
    deps: ['@iki/tools', '@iki/agent-loop', '@iki/llm-pi-ai', '@iki/system-prompt', '@iki/session', '@iki/store'],
  },
  {
    id: '@iki/tools',
    layer: 'runtime',
    role: {
      en: 'Pluggable built-in tools: OS-split bash/pwsh + durable background job manager, TypeScript PTC node:vm sandbox + .d.ts compiler, and swarm board tool.',
      zh: '可插拔内置工具：分 OS 的 bash/pwsh + 持久化后台 job、TypeScript PTC 沙箱与 .d.ts 编译器、Swarm 消息板工具。',
    },
    deps: ['@iki/agent', '@iki/core'],
  },
  {
    id: '@iki/agent-loop',
    layer: 'runtime',
    role: {
      en: 'Pure multi-step tool-calling loop with step budgets, cancellation propagation, and hooks.',
      zh: '纯函数式多步工具调用循环，处理步数预算、取消信号透传与生命周期钩子。',
    },
    deps: ['@iki/agent', '@iki/llm'],
  },
  {
    id: '@iki/llm-pi-ai',
    layer: 'runtime',
    role: {
      en: '@earendil-works/pi-ai provider adapter, live endpoint model discovery, sessionId affinity, and prompt-cache retention hints.',
      zh: '@earendil-works/pi-ai 适配层、实时模型发现、sessionId 亲和与 Prompt Cache 保持策略。',
    },
    deps: ['@iki/llm', '@iki/store', '@iki/system-prompt', '@iki/core'],
  },
  {
    id: '@iki/system-prompt',
    layer: 'runtime',
    role: {
      en: 'Deterministic static system prompt slots (persona → planPrompt → extraPrompt → transcriptSystem) and anchored <system_reminder> snapshots.',
      zh: '确定性静态系统提示词槽位组装与动态 <system_reminder> 增量快照格式。',
    },
    deps: ['@iki/core'],
  },
  {
    id: '@iki/session',
    layer: 'runtime',
    role: {
      en: 'Append-only SessionEvent JSONL store (~/.iki/sessions/<threadId>.jsonl) enabling lossless history replay and restart recovery.',
      zh: '只追加 SessionEvent JSONL 存储，支持无损会话回放与崩溃恢复。',
    },
    deps: ['@iki/core'],
  },
  {
    id: '@iki/store',
    layer: 'runtime',
    role: {
      en: 'Human-readable TOML/JSON configuration and state persistence (models.toml, settings.toml, thread metadata).',
      zh: '可读 TOML/JSON 配置与状态存储（models.toml、settings.toml、线程元数据）。',
    },
    deps: ['@iki/core'],
  },
  {
    id: '@iki/llm',
    layer: 'leaf',
    role: {
      en: 'Model-neutral transcript types and chronological UI ↔ ModelMessage projection without double-wrapping tool outputs.',
      zh: '模型无关的会话类型与严格时间序 UI ↔ ModelMessage 投影。',
    },
    deps: ['@iki/core'],
  },
  {
    id: '@iki/agent',
    layer: 'leaf',
    role: {
      en: 'BaseTool, ToolRegistry, AgentStep, and AgentHooks contracts shared by tools and loop executors.',
      zh: 'BaseTool、ToolRegistry、AgentStep 与 AgentHooks 契约层。',
    },
    deps: ['@iki/core'],
  },
  {
    id: '@iki/theme',
    layer: 'leaf',
    role: {
      en: 'Base46 color presets, schema validation, and theme compilation tokens.',
      zh: 'Base46 主题预设、Schema 校验与颜色编译令牌。',
    },
    deps: ['@iki/core'],
  },
  {
    id: '@iki/core',
    layer: 'leaf',
    role: {
      en: 'Leaf domain contracts: Zod schemas for settings.toml and models.toml, platform paths, structured logger, and action risk.',
      zh: '叶子契约层：settings.toml / models.toml Zod Schema、平台路径、结构化日志与风险分级。',
    },
    deps: [],
  },
];

const selectedId = ref<string>('@iki/harness');

const layers: Array<{ key: PkgInfo['layer']; title: Record<Locale, string> }> = [
  { key: 'shell', title: { en: 'Presentation Shells', zh: '展示壳层' } },
  { key: 'composition', title: { en: 'Composition Root', zh: '组合根' } },
  { key: 'runtime', title: { en: 'Runtime & Persistence', zh: '运行时与持久化' } },
  { key: 'leaf', title: { en: 'Leaf Contracts', zh: '基础契约层' } },
];

const selectedPkg = () => packages.find(p => p.id === selectedId.value) ?? packages[2]!;
</script>

<template>
  <div class="grid gap-6 lg:grid-cols-12">
    <!-- Layered package matrix -->
    <div class="space-y-3 lg:col-span-8">
      <div
        v-for="layer in layers"
        :key="layer.key"
        class="rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] p-3.5"
      >
        <div class="mb-2.5 flex items-center justify-between">
          <span class="font-mono text-[11px] uppercase tracking-wider text-[var(--fg-faint)]">
            {{ layer.title[locale] }}
          </span>
          <span class="font-mono text-[11px] text-[var(--fg-faint)]">↓</span>
        </div>
        <div class="flex flex-wrap gap-2">
          <button
            v-for="pkg in packages.filter(p => p.layer === layer.key)"
            :key="pkg.id"
            type="button"
            class="cursor-pointer rounded-md border px-3 py-1.5 font-mono text-[12.5px] transition-colors"
            :class="
              selectedId === pkg.id
                ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--fg)] font-semibold'
                : selectedPkg().deps.includes(pkg.id)
                  ? 'border-[var(--border-strong)] bg-[var(--bg-subtle)] text-[var(--fg)]'
                  : 'border-[var(--border)] bg-[var(--bg)] text-[var(--fg-muted)] hover:border-[var(--border-strong)] hover:text-[var(--fg)]'
            "
            @click="selectedId = pkg.id"
          >
            {{ pkg.id }}
          </button>
        </div>
      </div>
    </div>

    <!-- Selected package detail -->
    <div class="flex flex-col justify-between rounded-lg border border-[var(--border)] bg-[var(--bg-subtle)] p-5 lg:col-span-4">
      <div>
        <div class="font-mono text-[11px] uppercase tracking-wider text-[var(--fg-faint)]">
          {{ locale === 'zh' ? '模块边界详情' : 'Selected Package' }}
        </div>
        <h3 class="mt-1.5 font-mono text-[18px] font-semibold text-[var(--fg)]">
          {{ selectedPkg().id }}
        </h3>
        <p class="mt-3 text-[14.5px] leading-relaxed text-[var(--fg-muted)]">
          {{ selectedPkg().role[locale] }}
        </p>

        <div class="mt-5 border-t border-[var(--border)] pt-4">
          <div class="font-mono text-[11px] uppercase tracking-wider text-[var(--fg-faint)]">
            {{ locale === 'zh' ? '允许依赖（单向）' : 'Allowed Dependencies (One-Way)' }}
          </div>
          <div v-if="selectedPkg().deps.length > 0" class="mt-2 flex flex-wrap gap-1.5">
            <button
              v-for="dep in selectedPkg().deps"
              :key="dep"
              type="button"
              class="cursor-pointer rounded border border-[var(--border)] bg-[var(--bg-elevated)] px-2 py-0.5 font-mono text-[11.5px] text-[var(--fg-muted)] hover:border-[var(--accent)] hover:text-[var(--fg)]"
              @click="selectedId = dep"
            >
              {{ dep }}
            </button>
          </div>
          <div v-else class="mt-2 font-mono text-[12px] text-[var(--fg-muted)]">
            {{ locale === 'zh' ? '无内部依赖（纯叶子层）' : 'None (pure leaf package)' }}
          </div>
        </div>
      </div>

      <div class="mt-6 border-t border-[var(--border)] pt-3.5 font-mono text-[11.5px] text-[var(--fg-faint)]">
        depcruise (517 modules · 0 violations) · knip --production
      </div>
    </div>
  </div>
</template>
