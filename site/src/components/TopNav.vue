<script setup lang="ts">
import { BookOpen, Moon, Sun } from '@lucide/vue';
import type { Locale } from '../data/types';

defineProps<{
  locale: Locale;
  theme: 'light' | 'dark';
  activeRoute: { view: 'home' } | { view: 'docs'; slug: string };
}>();

const emit = defineEmits<{
  navigate: [hash: string];
  toggleLocale: [];
  toggleTheme: [];
}>();
</script>

<template>
  <header
    class="sticky top-0 z-40 h-14 border-b border-[var(--border)] backdrop-blur-md"
    style="background: color-mix(in oklch, var(--bg) 86%, transparent)"
  >
    <div class="mx-auto flex h-full max-w-[1220px] items-center justify-between gap-4 px-5 sm:px-8">
      <!-- Brand mark -->
      <a
        href="#/"
        class="flex items-center gap-2.5 text-[var(--fg)] no-underline transition-opacity hover:opacity-80"
        @click.prevent="emit('navigate', '#/')"
      >
        <img
          :src="'./iki-icon.png'"
          alt="iKi"
          class="h-7 w-7 rounded-md border border-[var(--border)] object-cover"
        />
        <span class="font-display text-[17px] font-bold tracking-tight">iKi</span>
        <span
          class="hidden rounded-full border border-[var(--border)] bg-[var(--bg-subtle)] px-2 py-0.5 font-mono text-[11px] text-[var(--fg-muted)] sm:inline-block"
        >
          v0.1.3
        </span>
      </a>

      <!-- Primary nav -->
      <nav class="hidden items-center gap-1 md:flex" aria-label="Main navigation">
        <a
          href="#/"
          class="rounded-md px-3 py-1.5 text-[14px] font-medium transition-colors"
          :class="
            activeRoute.view === 'home'
              ? 'bg-[var(--bg-subtle)] text-[var(--fg)]'
              : 'text-[var(--fg-muted)] hover:bg-[var(--bg-subtle)] hover:text-[var(--fg)]'
          "
          @click.prevent="emit('navigate', '#/')"
        >
          {{ locale === 'zh' ? '概览' : 'Overview' }}
        </a>
        <a
          href="#/docs/getting-started"
          class="rounded-md px-3 py-1.5 text-[14px] font-medium transition-colors"
          :class="
            activeRoute.view === 'docs' && activeRoute.slug === 'getting-started'
              ? 'bg-[var(--bg-subtle)] text-[var(--fg)]'
              : 'text-[var(--fg-muted)] hover:bg-[var(--bg-subtle)] hover:text-[var(--fg)]'
          "
          @click.prevent="emit('navigate', '#/docs/getting-started')"
        >
          {{ locale === 'zh' ? '快速开始' : 'Docs' }}
        </a>
        <a
          href="#/docs/cli-reference"
          class="rounded-md px-3 py-1.5 text-[14px] font-medium transition-colors"
          :class="
            activeRoute.view === 'docs' && activeRoute.slug === 'cli-reference'
              ? 'bg-[var(--bg-subtle)] text-[var(--fg)]'
              : 'text-[var(--fg-muted)] hover:bg-[var(--bg-subtle)] hover:text-[var(--fg)]'
          "
          @click.prevent="emit('navigate', '#/docs/cli-reference')"
        >
          {{ locale === 'zh' ? 'CLI 命令' : 'CLI Reference' }}
        </a>
        <a
          href="#/docs/mcp-code-mode"
          class="rounded-md px-3 py-1.5 text-[14px] font-medium transition-colors"
          :class="
            activeRoute.view === 'docs' && activeRoute.slug === 'mcp-code-mode'
              ? 'bg-[var(--bg-subtle)] text-[var(--fg)]'
              : 'text-[var(--fg-muted)] hover:bg-[var(--bg-subtle)] hover:text-[var(--fg)]'
          "
          @click.prevent="emit('navigate', '#/docs/mcp-code-mode')"
        >
          MCP Code Mode
        </a>
        <a
          href="#/docs/architecture"
          class="rounded-md px-3 py-1.5 text-[14px] font-medium transition-colors"
          :class="
            activeRoute.view === 'docs' && activeRoute.slug === 'architecture'
              ? 'bg-[var(--bg-subtle)] text-[var(--fg)]'
              : 'text-[var(--fg-muted)] hover:bg-[var(--bg-subtle)] hover:text-[var(--fg)]'
          "
          @click.prevent="emit('navigate', '#/docs/architecture')"
        >
          {{ locale === 'zh' ? '架构' : 'Architecture' }}
        </a>
      </nav>

      <!-- Utility controls -->
      <div class="flex items-center gap-2">
        <a
          href="#/docs/getting-started"
          class="inline-flex items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] px-2.5 py-1.5 text-[13px] font-medium text-[var(--fg)] md:hidden"
          @click.prevent="emit('navigate', '#/docs/getting-started')"
        >
          <BookOpen class="h-3.5 w-3.5" />
          <span>{{ locale === 'zh' ? '文档' : 'Docs' }}</span>
        </a>

        <button
          type="button"
          class="cursor-pointer rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] px-2.5 py-1 font-mono text-[12px] font-medium text-[var(--fg-muted)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--fg)]"
          :title="locale === 'zh' ? 'Switch to English' : '切换至简体中文'"
          @click="emit('toggleLocale')"
        >
          {{ locale === 'zh' ? 'EN' : '中文' }}
        </button>

        <button
          type="button"
          class="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] text-[var(--fg-muted)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--fg)]"
          :aria-label="theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'"
          @click="emit('toggleTheme')"
        >
          <Sun v-if="theme === 'dark'" class="h-4 w-4" />
          <Moon v-else class="h-4 w-4" />
        </button>

        <a
          href="https://github.com/irorange27/iKi"
          target="_blank"
          rel="noopener noreferrer"
          class="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] text-[var(--fg-muted)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--fg)]"
          aria-label="GitHub repository"
        >
          <svg viewBox="0 0 16 16" class="h-4 w-4 fill-current" aria-hidden="true">
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z"/>
          </svg>
        </a>
      </div>
    </div>
  </header>
</template>
