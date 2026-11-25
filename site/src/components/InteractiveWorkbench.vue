<script setup lang="ts">
import { ref } from 'vue';
import type { Locale } from '../data/types';

defineProps<{
  locale: Locale;
}>();

const activeTab = ref<'mcp' | 'cache' | 'swarm'>('mcp');
const mcpMode = ref<'code' | 'raw'>('code');
const activeTurn = ref<1 | 2 | 3>(2);
const activeWorker = ref<'reviewer-1' | 'refactor-2' | 'job_9f2a'>('reviewer-1');
</script>

<template>
  <div
    class="overflow-hidden rounded-xl border border-[var(--term-border)] bg-[var(--term-bg)] text-[var(--term-fg)]"
  >
    <!-- Top workbench bar -->
    <div
      class="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--term-border)] bg-[var(--term-surface)] px-4 py-2.5"
    >
      <div class="flex items-center gap-1.5" role="tablist" aria-label="Interactive showcase">
        <button
          type="button"
          role="tab"
          :aria-selected="activeTab === 'mcp'"
          class="cursor-pointer rounded-md px-2.5 py-1 font-mono text-[12px] transition-colors"
          :class="
            activeTab === 'mcp'
              ? 'bg-[var(--term-bg)] text-[var(--term-fg)] ring-1 ring-[var(--term-border)]'
              : 'text-[var(--term-muted)] hover:text-[var(--term-fg)]'
          "
          @click="activeTab = 'mcp'"
        >
          01 · MCP Code Mode
        </button>
        <button
          type="button"
          role="tab"
          :aria-selected="activeTab === 'cache'"
          class="cursor-pointer rounded-md px-2.5 py-1 font-mono text-[12px] transition-colors"
          :class="
            activeTab === 'cache'
              ? 'bg-[var(--term-bg)] text-[var(--term-fg)] ring-1 ring-[var(--term-border)]'
              : 'text-[var(--term-muted)] hover:text-[var(--term-fg)]'
          "
          @click="activeTab = 'cache'"
        >
          02 · KV-Cache
        </button>
        <button
          type="button"
          role="tab"
          :aria-selected="activeTab === 'swarm'"
          class="cursor-pointer rounded-md px-2.5 py-1 font-mono text-[12px] transition-colors"
          :class="
            activeTab === 'swarm'
              ? 'bg-[var(--term-bg)] text-[var(--term-fg)] ring-1 ring-[var(--term-border)]'
              : 'text-[var(--term-muted)] hover:text-[var(--term-fg)]'
          "
          @click="activeTab = 'swarm'"
        >
          03 · Swarm &amp; Jobs
        </button>
      </div>

      <span class="font-mono text-[11px] text-[var(--term-muted)]">
        {{ locale === 'zh' ? '交互演示' : 'interactive specimen' }}
      </span>
    </div>

    <!-- TAB 1: MCP Code Mode vs Raw MCP -->
    <div v-if="activeTab === 'mcp'" class="space-y-4 p-4 sm:p-5">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div class="inline-flex rounded-md border border-[var(--term-border)] bg-[var(--term-surface)] p-0.5 font-mono text-[11.5px]">
          <button
            type="button"
            class="cursor-pointer rounded px-2.5 py-1 transition-colors"
            :class="
              mcpMode === 'code'
                ? 'bg-[var(--term-bg)] text-[var(--term-ok)]'
                : 'text-[var(--term-muted)] hover:text-[var(--term-fg)]'
            "
            @click="mcpMode = 'code'"
          >
            iKi Code Mode (748 chars)
          </button>
          <button
            type="button"
            class="cursor-pointer rounded px-2.5 py-1 transition-colors"
            :class="
              mcpMode === 'raw'
                ? 'bg-[var(--term-bg)] text-[var(--term-warn)]'
                : 'text-[var(--term-muted)] hover:text-[var(--term-fg)]'
            "
            @click="mcpMode = 'raw'"
          >
            {{ locale === 'zh' ? '传统直出 MCP (~9,420 chars)' : 'Raw MCP (~9,420 chars)' }}
          </button>
        </div>

        <span
          class="font-mono text-[11.5px]"
          :class="mcpMode === 'code' ? 'text-[var(--term-ok)]' : 'text-[var(--term-warn)]'"
        >
          {{
            mcpMode === 'code'
              ? locale === 'zh'
                ? '顶层 0 个 MCP Schema · 1 轮并行'
                : '0 top-level MCP schemas · 1 turn'
              : locale === 'zh'
                ? '每轮全量注入 10 个 JSON Schema'
                : '10 JSON schemas injected every turn'
          }}
        </span>
      </div>

      <template v-if="mcpMode === 'code'">
        <div class="rounded-lg border border-[var(--term-border)] bg-[var(--term-surface)] p-3.5 font-mono text-[12px] leading-relaxed">
          <div class="mb-2 flex items-center justify-between text-[11px] text-[var(--term-muted)]">
            <span>L0 &lt;system_reminder name="mcp"&gt; (anchored once)</span>
            <span class="text-[var(--term-ok)]">748 chars</span>
          </div>
          <div class="text-[var(--term-accent)]">- calc (2 tools):</div>
          <div class="pl-3 text-[var(--term-fg)]">mcp.calc.add({ a: number; b: number })</div>
          <div class="pl-3 text-[var(--term-fg)]">mcp.calc.square({ n: number })</div>
          <div class="mt-1.5 text-[var(--term-accent)]">
            - inventory (8 tools): list_stock, extra_op_1..7 → <span class="text-[var(--term-warn)]">mcp.describe("inventory")</span>
          </div>
        </div>

        <div class="rounded-lg border border-[var(--term-border)] bg-[var(--term-surface)] p-3.5 font-mono text-[12px] leading-relaxed">
          <div class="mb-2 flex items-center justify-between text-[11px] text-[var(--term-muted)]">
            <span class="text-[var(--term-ok)]">✓ ptc · TypeScript sandbox (node:vm)</span>
            <span>4 MCP calls · 1 LLM round-trip</span>
          </div>
          <pre class="m-0 overflow-x-auto text-[12px] leading-relaxed text-[var(--term-fg)]"><code>const sq = await Promise.all([3, 5, 7].map(n =&gt; mcp.calc.square({ n })));
const dts = mcp.describe("inventory");
const stock = await mcp.inventory.list_stock({ inStockOnly: true });
return { sum: sq.reduce((s, r) =&gt; s + r.data.squared, 0), stock: stock.data };</code></pre>
          <div class="mt-2.5 border-t border-[var(--term-border)] pt-2 text-[var(--term-accent)]">
            ↳ { sum: 83, stock: ["Mechanical Keyboard (A1)", "4K Monitor (C3)"] }
          </div>
        </div>
      </template>

      <template v-else>
        <div class="rounded-lg border border-[var(--term-border)] bg-[var(--term-surface)] p-3.5 font-mono text-[12px] leading-relaxed">
          <div class="mb-2 flex items-center justify-between text-[11px] text-[var(--term-muted)]">
            <span>top-level tools[] payload (re-sent on every turn)</span>
            <span class="text-[var(--term-warn)]">~9,420 chars · cache bust on reconnect</span>
          </div>
          <pre class="m-0 overflow-x-auto text-[11.5px] leading-relaxed text-[var(--term-muted)]"><code>{ "name": "mcp_calc_add", "parameters": { "type": "object", "properties": { "a": { "type": "number" }, "b": { "type": "number" } }, "required": ["a", "b"] } },
{ "name": "mcp_calc_square", "parameters": { "type": "object", "properties": { "n": { "type": "number" } }, "required": ["n"] } },
{ "name": "mcp_inventory_list_stock", "parameters": { ... } },
{ "name": "mcp_inventory_extra_op_1", "parameters": { ... } },
// ... 6 more full JSON schemas dumped into top-level tools[]
// + 4 sequential tool round-trips polluting conversation history</code></pre>
        </div>
      </template>
    </div>

    <!-- TAB 2: KV-Cache Prefix Stability -->
    <div v-else-if="activeTab === 'cache'" class="space-y-4 p-4 sm:p-5">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div class="inline-flex rounded-md border border-[var(--term-border)] bg-[var(--term-surface)] p-0.5 font-mono text-[11.5px]">
          <button
            v-for="t in ([1, 2, 3] as const)"
            :key="t"
            type="button"
            class="cursor-pointer rounded px-2.5 py-1 transition-colors"
            :class="
              activeTurn === t
                ? 'bg-[var(--term-bg)] text-[var(--term-accent)]'
                : 'text-[var(--term-muted)] hover:text-[var(--term-fg)]'
            "
            @click="activeTurn = t"
          >
            Turn {{ t }}
          </button>
        </div>
        <span class="font-mono text-[11.5px] text-[var(--term-ok)]">
          {{
            activeTurn === 1
              ? locale === 'zh'
                ? '首次写入前缀缓存'
                : 'Initial prefix cached'
              : activeTurn === 2
                ? locale === 'zh'
                  ? '前缀字节一致 · 0 重复注入'
                  : 'Byte-identical prefix · 0 duplicate reminders'
                : locale === 'zh'
                  ? '新增服务器仅在末尾锚定增量'
                  : 'New server appended as Turn 3 delta only'
          }}
        </span>
      </div>

      <div class="space-y-2 font-mono text-[12px]">
        <div class="flex items-center justify-between rounded-md border border-[var(--term-border)] bg-[var(--term-surface)] px-3 py-2">
          <span>[system] persona → rules → &lt;project_context&gt; → &lt;skills&gt;</span>
          <span class="text-[var(--term-ok)]">FROZEN</span>
        </div>
        <div class="flex items-center justify-between rounded-md border border-[var(--term-border)] bg-[var(--term-surface)] px-3 py-2">
          <span>[tools] bash | job | ptc (3 static schemas)</span>
          <span class="text-[var(--term-ok)]">FROZEN</span>
        </div>
        <div class="flex items-center justify-between rounded-md border border-[var(--term-border)] bg-[var(--term-surface)] px-3 py-2">
          <span class="text-[var(--term-accent)]">[user · T1] &lt;system_reminder name="mcp"&gt; calc + inventory</span>
          <span class="text-[var(--term-muted)]">anchored @u1</span>
        </div>
        <div
          v-if="activeTurn >= 2"
          class="flex items-center justify-between rounded-md border border-[var(--term-border)] bg-[var(--term-surface)] px-3 py-2"
        >
          <span>[user · T2] "What was the sum of squares?"</span>
          <span class="text-[var(--term-ok)]">cache hit · no MCP re-inject</span>
        </div>
        <div
          v-if="activeTurn >= 3"
          class="flex items-center justify-between rounded-md border border-[var(--term-border)] bg-[var(--term-surface)] px-3 py-2"
        >
          <span class="text-[var(--term-warn)]">[user · T3] &lt;system_reminder name="mcp"&gt; disconnected: inventory</span>
          <span class="text-[var(--term-muted)]">delta @u3 · T1–T2 intact</span>
        </div>
      </div>
    </div>

    <!-- TAB 3: Swarm & Durable Jobs -->
    <div v-else class="space-y-4 p-4 sm:p-5">
      <div class="flex flex-wrap items-center justify-between gap-2 font-mono text-[11.5px]">
        <div class="flex flex-wrap gap-1.5">
          <button
            v-for="target in (['reviewer-1', 'refactor-2', 'job_9f2a'] as const)"
            :key="target"
            type="button"
            class="cursor-pointer rounded border px-2.5 py-1 transition-colors"
            :class="
              activeWorker === target
                ? 'border-[var(--term-accent)] bg-[var(--term-surface)] text-[var(--term-fg)]'
                : 'border-[var(--term-border)] text-[var(--term-muted)] hover:text-[var(--term-fg)]'
            "
            @click="activeWorker = target"
          >
            {{ target }}
          </button>
        </div>
        <span class="text-[var(--term-muted)]">Ctrl+W · Ctrl+J · Ctrl+K</span>
      </div>

      <div class="rounded-lg border border-[var(--term-border)] bg-[var(--term-surface)] p-3.5 font-mono text-[12px] leading-relaxed">
        <template v-if="activeWorker === 'reviewer-1'">
          <div class="mb-2 flex items-center justify-between text-[11px]">
            <span class="text-[var(--term-ok)]">● reviewer-1 · git worktree (share) · fast model</span>
            <span class="text-[var(--term-muted)]">running bash</span>
          </div>
          <div class="text-[var(--term-muted)]">$ pnpm exec vitest run packages/harness/tests</div>
          <div class="text-[var(--term-fg)]">✓ mcp_ptc_integration.test.ts (2 tests) 235ms</div>
          <div class="mt-2 border-t border-[var(--term-border)] pt-2 text-[var(--term-accent)]">
            [board] @coordinator: All 58 tests green; zero depcruise violations.
          </div>
        </template>
        <template v-else-if="activeWorker === 'refactor-2'">
          <div class="mb-2 flex items-center justify-between text-[11px]">
            <span class="text-[var(--term-accent)]">● refactor-2 · git worktree (share) · branch iki/worker-2</span>
            <span class="text-[var(--term-muted)]">thinking</span>
          </div>
          <div class="text-[var(--term-fg)]">Extracting catalog helpers from manager.ts → catalog.ts (639 lines)</div>
          <div class="mt-2 border-t border-[var(--term-border)] pt-2 text-[var(--term-muted)]">
            Isolated worktree prevents file conflicts while coordinator reviews diffs.
          </div>
        </template>
        <template v-else>
          <div class="mb-2 flex items-center justify-between text-[11px]">
            <span class="text-[var(--term-warn)]">● job_9f2a · durable background job · pid 48210</span>
            <span class="text-[var(--term-muted)]">Ctrl+K to kill</span>
          </div>
          <div class="text-[var(--term-muted)]">$ pnpm run ci:quality</div>
          <div class="text-[var(--term-fg)]">✔ no dependency violations found (517 modules)</div>
          <div class="text-[var(--term-ok)]">✂ Excellent, Knip found no issues.</div>
        </template>
      </div>

      <!-- Bottom live activity strip preview -->
      <div class="flex flex-wrap items-center justify-between gap-2 rounded-md border border-[var(--term-border)] bg-[var(--term-surface)] px-3 py-2 font-mono text-[11.5px]">
        <span>
          <span class="text-[var(--term-ok)]">●</span> Swarm: 2 active
          <span class="text-[var(--term-muted)]">·</span>
          <span class="text-[var(--term-warn)]">●</span> Jobs: 1 running
        </span>
        <span class="text-[var(--term-muted)]">mcp:10t(code) · 3 builtin</span>
      </div>
    </div>
  </div>
</template>
