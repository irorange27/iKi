<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import DocsPage from './components/DocsPage.vue';
import LandingPage from './components/LandingPage.vue';
import TopNav from './components/TopNav.vue';
import type { Locale } from './data/types';

type RouteState = { view: 'home' } | { view: 'docs'; slug: string };

const parseHash = (hash: string): RouteState => {
  const clean = hash.replace(/^#/, '').trim();
  const match = /^\/docs\/([a-z0-9-]+)$/i.exec(clean);
  if (match) return { view: 'docs', slug: match[1]!.toLowerCase() };
  if (clean === '/docs') return { view: 'docs', slug: 'getting-started' };
  return { view: 'home' };
};

const detectInitialLocale = (): Locale => {
  try {
    const saved = localStorage.getItem('iki-site-locale');
    if (saved === 'en' || saved === 'zh') return saved;
  } catch {
    /* ignore storage failures */
  }
  return navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en';
};

const detectInitialTheme = (): 'light' | 'dark' => {
  try {
    const saved = localStorage.getItem('iki-site-theme');
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {
    /* ignore storage failures */
  }
  return 'light';
};

const locale = ref<Locale>(detectInitialLocale());
const theme = ref<'light' | 'dark'>(detectInitialTheme());
const route = ref<RouteState>(parseHash(window.location.hash));

const syncThemeDom = (value: 'light' | 'dark') => {
  document.documentElement.dataset.theme = value;
  try {
    localStorage.setItem('iki-site-theme', value);
  } catch {
    /* ignore */
  }
};

watch(theme, syncThemeDom, { immediate: true });
watch(locale, value => {
  document.documentElement.lang = value === 'zh' ? 'zh-CN' : 'en';
  try {
    localStorage.setItem('iki-site-locale', value);
  } catch {
    /* ignore */
  }
}, { immediate: true });

const navigate = (hash: string) => {
  if (window.location.hash !== hash) {
    window.location.hash = hash;
  }
  route.value = parseHash(hash);
  window.scrollTo(0, 0);
};

const onHashChange = () => {
  route.value = parseHash(window.location.hash);
};

onMounted(() => window.addEventListener('hashchange', onHashChange));
onBeforeUnmount(() => window.removeEventListener('hashchange', onHashChange));
</script>

<template>
  <div class="flex min-h-screen flex-col bg-[var(--bg)] text-[var(--fg)]">
    <TopNav
      :locale="locale"
      :theme="theme"
      :active-route="route"
      @navigate="navigate"
      @toggle-locale="locale = locale === 'zh' ? 'en' : 'zh'"
      @toggle-theme="theme = theme === 'dark' ? 'light' : 'dark'"
    />

    <main class="flex-1">
      <LandingPage v-if="route.view === 'home'" :locale="locale" @navigate="navigate" />
      <DocsPage v-else :locale="locale" :slug="route.slug" @navigate="navigate" />
    </main>

    <footer class="border-t border-[var(--border)] bg-[var(--bg-subtle)]">
      <div class="mx-auto flex max-w-[1220px] flex-col items-start justify-between gap-4 px-5 py-8 text-[13px] text-[var(--fg-muted)] sm:flex-row sm:items-center sm:px-8">
        <div class="flex items-center gap-2.5">
          <img :src="'./iki-icon.png'" alt="iKi" class="h-5 w-5 rounded border border-[var(--border)]" />
          <span class="font-display font-semibold text-[var(--fg)]">iKi</span>
          <span class="font-mono text-[11.5px] text-[var(--fg-faint)]">v0.1.2 · AGPLv3</span>
        </div>
        <div class="flex flex-wrap items-center gap-5">
          <a href="#/docs/getting-started" class="text-[var(--fg-muted)] no-underline hover:text-[var(--fg)]" @click.prevent="navigate('#/docs/getting-started')">
            {{ locale === 'zh' ? '文档' : 'Docs' }}
          </a>
          <a href="#/docs/cli-reference" class="text-[var(--fg-muted)] no-underline hover:text-[var(--fg)]" @click.prevent="navigate('#/docs/cli-reference')">
            {{ locale === 'zh' ? 'CLI 参考' : 'CLI Reference' }}
          </a>
          <a href="https://www.npmjs.com/package/@irorange27/iki" target="_blank" rel="noopener noreferrer" class="text-[var(--fg-muted)] no-underline hover:text-[var(--fg)]">
            npm (@irorange27/iki)
          </a>
          <a href="https://github.com/irorange27/iKi" target="_blank" rel="noopener noreferrer" class="text-[var(--fg-muted)] no-underline hover:text-[var(--fg)]">
            GitHub
          </a>
          <a href="https://github.com/irorange27/iKi/releases/latest" target="_blank" rel="noopener noreferrer" class="text-[var(--fg-muted)] no-underline hover:text-[var(--fg)]">
            {{ locale === 'zh' ? '发布版本' : 'Releases' }}
          </a>
        </div>
      </div>
    </footer>
  </div>
</template>
