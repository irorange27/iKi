import { computed, ref, watch, type Ref } from 'vue';
import { storeToRefs } from 'pinia';

import { useI18n } from '../../../i18n';
import { useConfigStore } from '../../../store/config';
import type { ChatThread } from '@iki/backend/types/chat';
import type {
  AffectStateEntry,
  LongMemoryEntry,
  LongMemorySearchResult,
} from '@iki/backend/types/memory';
import { getErrorMessage } from '@iki/backend/utils/errors';
import { getElectronAPI } from '../../../services/electron_api';
import {
  formatJson,
  formatJsonList,
  formatTimestamp,
  parseAffectStateSnapshot,
} from '../settings_formatters';

const ALL_THREADS = '__all__';

export const useSettingsMemoryViewer = (active: Readonly<Ref<boolean>>) => {
  const electronAPI = getElectronAPI();
  const { t } = useI18n();
  const configStore = useConfigStore();
  const { config } = storeToRefs(configStore);

  const memoryThreads = ref<ChatThread[]>([]);
  const selectedMemoryThreadId = ref('');
  const longMemoryEntries = ref<LongMemoryEntry[]>([]);
  const memorySearchQuery = ref('');
  const memorySearchResults = ref<LongMemorySearchResult[]>([]);
  const memoryLoading = ref(false);
  const memorySearchLoading = ref(false);
  const memoryError = ref('');
  const memorySearchError = ref('');
  const affectStateEntry = ref<AffectStateEntry | null>(null);
  const affectStateLoading = ref(false);
  const affectStateError = ref('');
  const memoryThreadsLoaded = ref(false);
  const newLongMemoryThreadId = ref('');
  const newLongMemorySummary = ref('');
  const memoryMutationLoading = ref(false);
  const memoryMutationError = ref('');
  const editingLongMemoryId = ref('');
  const editingLongMemorySummary = ref('');
  const editingLongMemoryOriginal = ref('');

  const hasMemoryQuery = computed(() => memorySearchQuery.value.trim().length > 0);
  const isAllThreadsSelected = computed(() => selectedMemoryThreadId.value === ALL_THREADS);
  const parsedAffectState = computed(() => parseAffectStateSnapshot(affectStateEntry.value?.state));
  const isMemoryThreadLocked = computed(
    () => !!selectedMemoryThreadId.value && selectedMemoryThreadId.value !== ALL_THREADS
  );
  const canCreateLongMemory = computed(
    () =>
      newLongMemorySummary.value.trim().length > 0 &&
      newLongMemoryThreadId.value.trim().length > 0
  );
  const canSaveLongMemoryEdit = computed(() => {
    if (!editingLongMemoryId.value) return false;
    const summary = editingLongMemorySummary.value.trim();
    return summary.length > 0 && summary !== editingLongMemoryOriginal.value.trim();
  });
  const showCreateThreadHint = computed(
    () => selectedMemoryThreadId.value === ALL_THREADS && !newLongMemoryThreadId.value
  );

  const threadLabelMap = computed(() => {
    const map = new Map<string, string>();
    for (const thread of memoryThreads.value) {
      map.set(thread.id, thread.title || thread.id);
    }
    return map;
  });

  const memoryViewerThreadOptions = computed(() => [
    { value: ALL_THREADS, label: t('settings.memory.allThreads') },
    ...memoryThreads.value.map(thread => ({
      value: thread.id,
      label: thread.title || thread.id,
    })),
  ]);

  const memoryEditorThreadOptions = computed(() =>
    memoryThreads.value.map(thread => ({
      value: thread.id,
      label: thread.title || thread.id,
    }))
  );

  const getThreadLabel = (threadId?: string): string => {
    if (!threadId) return t('settings.memory.unknownThread');
    return threadLabelMap.value.get(threadId) || threadId;
  };

  const formatMetricDecimal = (value: unknown, digits = 2): string => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return t('settings.memory.na');
    return value.toFixed(digits);
  };

  const resetEditingState = () => {
    editingLongMemoryId.value = '';
    editingLongMemorySummary.value = '';
    editingLongMemoryOriginal.value = '';
  };

  const syncNewLongMemoryThread = () => {
    if (selectedMemoryThreadId.value && selectedMemoryThreadId.value !== ALL_THREADS) {
      newLongMemoryThreadId.value = selectedMemoryThreadId.value;
      return;
    }
    if (selectedMemoryThreadId.value === ALL_THREADS) {
      newLongMemoryThreadId.value = '';
      return;
    }
    if (!newLongMemoryThreadId.value && memoryThreads.value.length > 0) {
      newLongMemoryThreadId.value = memoryThreads.value[0].id;
    }
  };

  const refreshMemory = async () => {
    if (!selectedMemoryThreadId.value) return;
    memoryLoading.value = true;
    memoryError.value = '';
    affectStateLoading.value = true;
    affectStateError.value = '';
    try {
      const shouldFetchAffect = !isAllThreadsSelected.value;
      const [longEntries, affectEntry] = isAllThreadsSelected.value
        ? await Promise.all([electronAPI.memory.long.listAll(25), Promise.resolve(null)])
        : await Promise.all([
            electronAPI.memory.long.list(selectedMemoryThreadId.value, 25),
            shouldFetchAffect
              ? electronAPI.memory.affect.get(selectedMemoryThreadId.value)
              : Promise.resolve(null),
          ]);
      longMemoryEntries.value = Array.isArray(longEntries) ? longEntries : [];
      affectStateEntry.value = affectEntry || null;
      if (
        editingLongMemoryId.value &&
        !longMemoryEntries.value.some(entry => entry.id === editingLongMemoryId.value)
      ) {
        resetEditingState();
      }
    } catch (error: unknown) {
      const message = getErrorMessage(error);
      memoryError.value = t('settings.memory.error.loadMemory', { error: message });
      affectStateError.value = t('settings.memory.error.loadAffect', { error: message });
    } finally {
      memoryLoading.value = false;
      affectStateLoading.value = false;
    }
  };

  const runMemorySearch = async () => {
    if (!selectedMemoryThreadId.value) return;
    if (!memorySearchQuery.value.trim()) {
      memorySearchResults.value = [];
      return;
    }
    memorySearchLoading.value = true;
    memorySearchError.value = '';
    try {
      const query = memorySearchQuery.value.trim();
      const options = {
        limit: config.value.memory.maxRetrievalCount,
        threshold: config.value.memory.similarThreshold,
        force: true,
      };
      const results = isAllThreadsSelected.value
        ? await electronAPI.memory.long.searchAll(query, options)
        : await electronAPI.memory.long.search(selectedMemoryThreadId.value, query, options);
      memorySearchResults.value = Array.isArray(results) ? results : [];
    } catch (error: unknown) {
      memorySearchError.value = t('settings.memory.error.searchFailed', {
        error: getErrorMessage(error),
      });
    } finally {
      memorySearchLoading.value = false;
    }
  };

  const loadMemoryThreads = async () => {
    if (memoryThreadsLoaded.value) return;
    try {
      const threads = await electronAPI.chat.threads.list();
      memoryThreads.value = Array.isArray(threads) ? threads : [];
      memoryThreadsLoaded.value = true;
      if (!selectedMemoryThreadId.value && memoryThreads.value.length > 0) {
        selectedMemoryThreadId.value = memoryThreads.value[0].id;
        syncNewLongMemoryThread();
        await refreshMemory();
      } else if (selectedMemoryThreadId.value === ALL_THREADS) {
        syncNewLongMemoryThread();
        await refreshMemory();
      } else {
        syncNewLongMemoryThread();
      }
    } catch (error: unknown) {
      memoryError.value = t('settings.memory.error.loadThreads', {
        error: getErrorMessage(error),
      });
    }
  };

  const selectMemoryThread = async (threadId: string) => {
    selectedMemoryThreadId.value = threadId;
    syncNewLongMemoryThread();
    memorySearchResults.value = [];
    memorySearchError.value = '';
    memoryMutationError.value = '';
    if (editingLongMemoryId.value) {
      resetEditingState();
    }
    await refreshMemory();
  };

  const updateNewLongMemoryThreadSelection = (threadId: string) => {
    newLongMemoryThreadId.value = threadId;
  };

  const createLongMemory = async () => {
    const threadId = newLongMemoryThreadId.value.trim();
    const summary = newLongMemorySummary.value.trim();
    if (!threadId) {
      memoryMutationError.value = t('settings.memory.error.selectThread');
      return;
    }
    if (!summary) {
      memoryMutationError.value = t('settings.memory.error.summaryRequired');
      return;
    }

    memoryMutationLoading.value = true;
    memoryMutationError.value = '';
    try {
      await electronAPI.memory.long.add({
        thread_id: threadId,
        summary,
        metadata: {
          source: 'manual',
          createdAt: new Date().toISOString(),
        },
      });
      newLongMemorySummary.value = '';
      await refreshMemory();
      if (hasMemoryQuery.value) {
        await runMemorySearch();
      }
    } catch (error: unknown) {
      memoryMutationError.value = t('settings.memory.error.addFailed', {
        error: getErrorMessage(error),
      });
    } finally {
      memoryMutationLoading.value = false;
    }
  };

  const startEditLongMemory = (entry: LongMemoryEntry) => {
    editingLongMemoryId.value = entry.id;
    editingLongMemorySummary.value = entry.summary || '';
    editingLongMemoryOriginal.value = entry.summary || '';
    memoryMutationError.value = '';
  };

  const cancelEditLongMemory = () => {
    resetEditingState();
  };

  const saveLongMemoryEdit = async (entry: LongMemoryEntry) => {
    if (editingLongMemoryId.value !== entry.id) return;
    const summary = editingLongMemorySummary.value.trim();
    if (!summary) {
      memoryMutationError.value = t('settings.memory.error.summaryRequired');
      return;
    }
    if (summary === editingLongMemoryOriginal.value.trim()) {
      cancelEditLongMemory();
      return;
    }

    memoryMutationLoading.value = true;
    memoryMutationError.value = '';
    try {
      await electronAPI.memory.long.update(entry.id, { summary });
      await refreshMemory();
      if (hasMemoryQuery.value) {
        await runMemorySearch();
      }
      cancelEditLongMemory();
    } catch (error: unknown) {
      memoryMutationError.value = t('settings.memory.error.updateFailed', {
        error: getErrorMessage(error),
      });
    } finally {
      memoryMutationLoading.value = false;
    }
  };

  const deleteLongMemoryEntry = async (entry: LongMemoryEntry) => {
    if (!entry?.id) return;
    if (!window.confirm(t('settings.memory.confirmDelete'))) return;

    memoryMutationLoading.value = true;
    memoryMutationError.value = '';
    try {
      await electronAPI.memory.long.delete(entry.id);
      if (editingLongMemoryId.value === entry.id) {
        cancelEditLongMemory();
      }
      await refreshMemory();
      if (hasMemoryQuery.value) {
        await runMemorySearch();
      }
    } catch (error: unknown) {
      memoryMutationError.value = t('settings.memory.error.deleteFailed', {
        error: getErrorMessage(error),
      });
    } finally {
      memoryMutationLoading.value = false;
    }
  };

  watch(
    active,
    isActive => {
      if (isActive) {
        void loadMemoryThreads();
      }
    },
    { immediate: true }
  );

  return {
    affectStateEntry,
    affectStateError,
    affectStateLoading,
    canCreateLongMemory,
    canSaveLongMemoryEdit,
    cancelEditLongMemory,
    createLongMemory,
    deleteLongMemoryEntry,
    editingLongMemoryId,
    editingLongMemoryOriginal,
    editingLongMemorySummary,
    formatJson,
    formatJsonList,
    formatMetricDecimal,
    formatTimestamp,
    getThreadLabel,
    hasMemoryQuery,
    isAllThreadsSelected,
    isMemoryThreadLocked,
    longMemoryEntries,
    memoryEditorThreadOptions,
    memoryError,
    memoryLoading,
    memoryMutationError,
    memoryMutationLoading,
    memorySearchError,
    memorySearchLoading,
    memorySearchQuery,
    memorySearchResults,
    memoryThreads,
    memoryViewerThreadOptions,
    newLongMemorySummary,
    newLongMemoryThreadId,
    parsedAffectState,
    refreshMemory,
    runMemorySearch,
    saveLongMemoryEdit,
    selectMemoryThread,
    selectedMemoryThreadId,
    showCreateThreadHint,
    startEditLongMemory,
    updateNewLongMemoryThreadSelection,
  };
};
