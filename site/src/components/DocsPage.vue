<script setup lang="ts">
import { ArrowLeft, ArrowRight, Check, Copy, Menu, Search, X } from '@lucide/vue';
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { DOC_PAGES, findDocPage } from '../data/docs';
import type { Locale } from '../data/types';

const props = defineProps<{
  locale: Locale;
  slug: string;
}>();

const emit = defineEmits<{
  navigate: [hash: string];
}>();

const query = ref('');
const mobileNavOpen = ref(false);
const copiedKey = ref<string | null>(null);
const searchInputRef = ref<HTMLInputElement | null>(null);

const currentPage = computed(() => findDocPage(props.slug));
const currentIndex = computed(() => DOC_PAGES.findIndex(p => p.slug === currentPage.value.slug));
const prevPage = computed(() => (currentIndex.value > 0 ? DOC_PAGES[currentIndex.value - 1] : null));
const nextPage = computed(() =>
  currentIndex.value >= 0 && currentIndex.value < DOC_PAGES.length - 1
    ? DOC_PAGES[currentIndex.value + 1]
    : null
);

const filteredPages = computed(() => {
  const q = query.value.trim().toLowerCase();
  if (!q) return DOC_PAGES;
  return DOC_PAGES.filter(page => {
    const haystack = [
      page.slug,
      page.title.en,
      page.title.zh,
      page.summary.en,
      page.summary.zh,
      ...page.sections.flatMap(s => [s.title.en, s.title.zh]),
    ]
      .join(' ')
      .toLowerCase();
    return haystack.includes(q);
  });
});

const groupedPages = computed(() => {
  const groups = new Map<string, typeof DOC_PAGES>();
  for (const page of filteredPages.value) {
    const cat = page.category[props.locale];
    const list = groups.get(cat) ?? [];
    list.push(page);
    groups.set(cat, list);
  }
  return [...groups.entries()];
});

const copyCode = async (key: string, code: string) => {
  try {
    await navigator.clipboard.writeText(code);
    copiedKey.value = key;
    window.setTimeout(() => {
      if (copiedKey.value === key) copiedKey.value = null;
    }, 1600);
  } catch {
    /* ignore clipboard permission errors */
  }
};

const selectDoc = (slug: string) => {
  mobileNavOpen.value = false;
  emit('navigate', `#/docs/${slug}`);
};

const scrollToSection = (id: string) => {
  const el = document.getElementById(id);
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
};

const handleKeydown = (e: KeyboardEvent) => {
  if (
    e.key === '/' &&
    document.activeElement?.tagName !== 'INPUT' &&
    document.activeElement?.tagName !== 'TEXTAREA'
  ) {
    e.preventDefault();
    searchInputRef.value?.focus();
  }
};

onMounted(() => window.addEventListener('keydown', handleKeydown));
onBeforeUnmount(() => window.removeEventListener('keydown', handleKeydown));
</script>

<template>
  <div class="mx-auto max-w-[1220px] px-5 sm:px-8">
    <!-- Mobile docs bar -->
    <div class="flex items-center justify-between border-b border-[var(--border)] py-3 lg:hidden">
      <button
        type="button"
        class="inline-flex cursor-pointer items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-1.5 text-[13.5px] font-medium text-[var(--fg)]"
        @click="mobileNavOpen = !mobileNavOpen"
      >
        <X v-if="mobileNavOpen" class="h-4 w-4" />
        <Menu v-else class="h-4 w-4" />
        <span>{{ currentPage.title[locale] }}</span>
      </button>
      <span class="font-mono text-[11.5px] text-[var(--fg-faint)]">
        {{ currentPage.category[locale] }}
      </span>
    </div>

    <div class="grid gap-10 py-8 lg:grid-cols-[240px_minmax(0,1fr)] xl:grid-cols-[240px_minmax(0,1fr)_200px]">
      <!-- Left sidebar -->
      <aside
        class="lg:sticky lg:top-20 lg:block lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto"
        :class="mobileNavOpen ? 'block border-b border-[var(--border)] pb-6' : 'hidden'"
      >
        <div class="relative mb-5">
          <Search class="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-[var(--fg-faint)]" />
          <input
            ref="searchInputRef"
            v-model="query"
            type="search"
            :placeholder="locale === 'zh' ? '筛选文档 (/)' : 'Filter docs (/)'"
            class="w-full rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] py-1.5 pr-3 pl-8 text-[13px] text-[var(--fg)] placeholder:text-[var(--fg-faint)] focus:border-[var(--accent)] focus:outline-none"
          />
        </div>

        <nav class="space-y-5" aria-label="Documentation navigation">
          <div v-for="[cat, pages] in groupedPages" :key="cat">
            <div class="mb-2 px-2 font-mono text-[11px] font-semibold uppercase tracking-wider text-[var(--fg-faint)]">
              {{ cat }}
            </div>
            <ul class="m-0 list-none space-y-0.5 p-0">
              <li v-for="page in pages" :key="page.slug">
                <a
                  :href="`#/docs/${page.slug}`"
                  class="block rounded-md px-2.5 py-1.5 text-[13.5px] no-underline transition-colors"
                  :class="
                    page.slug === currentPage.slug
                      ? 'bg-[var(--accent-soft)] font-semibold text-[var(--fg)]'
                      : 'text-[var(--fg-muted)] hover:bg-[var(--bg-subtle)] hover:text-[var(--fg)]'
                  "
                  @click.prevent="selectDoc(page.slug)"
                >
                  {{ page.title[locale] }}
                </a>
              </li>
            </ul>
          </div>
          <div v-if="groupedPages.length === 0" class="px-2 text-[13px] text-[var(--fg-faint)]">
            {{ locale === 'zh' ? '没有匹配的文档章节。' : 'No matching documentation pages.' }}
          </div>
        </nav>
      </aside>

      <!-- Main reading column -->
      <article class="docs-prose min-w-0 pb-16">
        <div class="font-mono text-[11.5px] font-medium uppercase tracking-wider text-[var(--accent)]">
          {{ currentPage.category[locale] }}
        </div>
        <h1
          class="mt-2 font-display font-bold leading-tight text-[var(--fg)]"
          style="font-size: clamp(1.9rem, 3vw, 2.55rem)"
        >
          {{ currentPage.title[locale] }}
        </h1>
        <p class="mt-3 text-[16px] leading-relaxed text-[var(--fg-muted)]">
          {{ currentPage.summary[locale] }}
        </p>

        <section v-for="section in currentPage.sections" :key="section.id">
          <h2 :id="section.id">{{ section.title[locale] }}</h2>

          <template v-for="(block, idx) in section.blocks" :key="`${section.id}-${idx}`">
            <p v-if="block.kind === 'p'">{{ block.text[locale] }}</p>

            <ul v-else-if="block.kind === 'ul'">
              <li v-for="(item, i) in block.items" :key="i">{{ item[locale] }}</li>
            </ul>

            <div
              v-else-if="block.kind === 'code'"
              class="my-4 overflow-hidden rounded-lg border border-[var(--term-border)] bg-[var(--term-bg)]"
            >
              <div
                class="flex items-center justify-between border-b border-[var(--term-border)] bg-[var(--term-surface)] px-3.5 py-2 font-mono text-[11px] text-[var(--term-muted)]"
              >
                <span>{{ block.label || block.lang }}</span>
                <button
                  type="button"
                  class="inline-flex cursor-pointer items-center gap-1 rounded border border-[var(--term-border)] bg-[var(--term-bg)] px-2 py-0.5 text-[11px] text-[var(--term-muted)] transition-colors hover:text-[var(--term-fg)]"
                  @click="copyCode(`${section.id}-${idx}`, block.code)"
                >
                  <Check v-if="copiedKey === `${section.id}-${idx}`" class="h-3 w-3 text-[var(--term-ok)]" />
                  <Copy v-else class="h-3 w-3" />
                  <span>{{ copiedKey === `${section.id}-${idx}` ? (locale === 'zh' ? '已复制' : 'Copied') : (locale === 'zh' ? '复制' : 'Copy') }}</span>
                </button>
              </div>
              <pre class="m-0 border-0 bg-transparent p-4 text-[12.5px] leading-relaxed text-[var(--term-fg)]"><code>{{ block.code }}</code></pre>
            </div>

            <div v-else-if="block.kind === 'table'" class="my-4 overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)]">
              <table class="m-0 w-full border-collapse text-[13.5px]">
                <thead>
                  <tr>
                    <th v-for="(h, hi) in block.headers[locale]" :key="hi">{{ h }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(row, ri) in block.rows" :key="ri">
                    <td
                      v-for="(cell, ci) in row[locale]"
                      :key="ci"
                      :class="ci === 0 ? 'font-mono text-[12.5px] font-medium text-[var(--fg)]' : ''"
                    >
                      {{ cell }}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div
              v-else-if="block.kind === 'note'"
              class="my-5 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-subtle)] p-4"
            >
              <div class="font-display text-[14px] font-semibold text-[var(--fg)]">
                {{ block.title[locale] }}
              </div>
              <p class="mt-1 mb-0 text-[13.5px] text-[var(--fg-muted)]">
                {{ block.text[locale] }}
              </p>
            </div>
          </template>
        </section>

        <!-- Prev / Next pagination -->
        <div class="mt-12 grid gap-3 border-t border-[var(--border)] pt-6 sm:grid-cols-2">
          <a
            v-if="prevPage"
            :href="`#/docs/${prevPage.slug}`"
            class="flex flex-col rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] p-4 no-underline transition-colors hover:border-[var(--accent)]"
            @click.prevent="selectDoc(prevPage.slug)"
          >
            <span class="inline-flex items-center gap-1 font-mono text-[11px] text-[var(--fg-faint)]">
              <ArrowLeft class="h-3 w-3" />
              {{ locale === 'zh' ? '上一篇' : 'Previous' }}
            </span>
            <span class="mt-1 font-display text-[14.5px] font-semibold text-[var(--fg)]">
              {{ prevPage.title[locale] }}
            </span>
          </a>
          <div v-else />

          <a
            v-if="nextPage"
            :href="`#/docs/${nextPage.slug}`"
            class="flex flex-col items-end rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] p-4 text-right no-underline transition-colors hover:border-[var(--accent)]"
            @click.prevent="selectDoc(nextPage.slug)"
          >
            <span class="inline-flex items-center gap-1 font-mono text-[11px] text-[var(--fg-faint)]">
              {{ locale === 'zh' ? '下一篇' : 'Next' }}
              <ArrowRight class="h-3 w-3" />
            </span>
            <span class="mt-1 font-display text-[14.5px] font-semibold text-[var(--fg)]">
              {{ nextPage.title[locale] }}
            </span>
          </a>
        </div>
      </article>

      <!-- Right TOC outline -->
      <aside class="sticky top-20 hidden max-h-[calc(100vh-6rem)] overflow-y-auto xl:block">
        <div class="mb-2.5 font-mono text-[11px] font-semibold uppercase tracking-wider text-[var(--fg-faint)]">
          {{ locale === 'zh' ? '本页目录' : 'On This Page' }}
        </div>
        <ul class="m-0 list-none space-y-1.5 border-l border-[var(--border)] pl-3 p-0">
          <li v-for="section in currentPage.sections" :key="section.id">
            <button
              type="button"
              class="cursor-pointer bg-transparent p-0 text-left text-[12.5px] text-[var(--fg-muted)] transition-colors hover:text-[var(--fg)]"
              @click="scrollToSection(section.id)"
            >
              {{ section.title[locale] }}
            </button>
          </li>
        </ul>
      </aside>
    </div>
  </div>
</template>
