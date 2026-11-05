import { nextTick, ref, watch } from 'vue';
import type { ThreadContentMatch } from '@iki/ai/message/thread_content_search';
import { createLogger } from '../logger';
import { isExternalThread } from '../modules/chat/thread_origin';
import type { SidebarChatThread } from './useSidebarData';

const sidebarSearchLogger = createLogger({ module: 'sidebar' });

/**
 * Sidebar content search: the instant title filter used by both thread lists
 * plus the debounced (280ms) full-content search over the backend.
 */
export const useSidebarSearch = (deps: {
  searchContent?: (query: string) => Promise<unknown>;
}) => {
  const isSearchOpen = ref(false);
  const searchQuery = ref('');
  const searchInputRef = ref<HTMLInputElement | null>(null);
  const contentMatches = ref<ThreadContentMatch[]>([]);
  let contentSearchTimer: ReturnType<typeof setTimeout> | null = null;

  const runContentSearch = async (query: string) => {
    const { searchContent } = deps;
    if (typeof searchContent !== 'function' || !query.trim()) {
      contentMatches.value = [];
      return;
    }
    try {
      const matches = (await searchContent(query.trim())) as ThreadContentMatch[];
      contentMatches.value = Array.isArray(matches)
        ? matches.filter(match => !isExternalThread(match as never))
        : [];
    } catch (error) {
      sidebarSearchLogger.event({
        level: 'warn',
        event: 'chat.search.content',
        outcome: 'failed',
        error,
      });
      contentMatches.value = [];
    }
  };

  const toggleSearch = () => {
    if (isSearchOpen.value) {
      closeSearch();
      return;
    }
    isSearchOpen.value = true;
    void nextTick(() => searchInputRef.value?.focus());
  };

  const clearSearch = () => {
    searchQuery.value = '';
    contentMatches.value = [];
    searchInputRef.value?.focus();
  };

  const closeSearch = () => {
    isSearchOpen.value = false;
    searchQuery.value = '';
  };

  watch(searchQuery, query => {
    if (contentSearchTimer) clearTimeout(contentSearchTimer);
    if (!query.trim()) {
      contentMatches.value = [];
      return;
    }
    contentSearchTimer = setTimeout(() => {
      contentSearchTimer = null;
      void runContentSearch(query);
    }, 280);
  });

  const matchesSearch = (thread: SidebarChatThread) => {
    const query = searchQuery.value.trim().toLowerCase();
    if (!query) return true;
    return thread.title.toLowerCase().includes(query);
  };

  return {
    isSearchOpen,
    searchQuery,
    searchInputRef,
    contentMatches,
    toggleSearch,
    clearSearch,
    closeSearch,
    matchesSearch,
  };
};
