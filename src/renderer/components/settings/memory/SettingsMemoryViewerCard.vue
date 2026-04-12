<template>
  <div class="settings-card memory-viewer">
    <div class="card-title">{{ t('settings.memory.viewerTitle') }}</div>
    <p class="card-help">{{ t('settings.memory.viewerDescription') }}</p>
    <div class="memory-controls">
      <label class="input-label">
        <span>{{ t('common.thread') }}</span>
        <SettingsSelect
          :model-value="selectedMemoryThreadId"
          :options="memoryViewerThreadOptions"
          :placeholder="t('settings.memory.threadPlaceholder')"
          :empty-text="t('settings.memory.noThreadsAvailable')"
          :aria-label="t('settings.memory.viewerThreadAria')"
          @update:model-value="selectMemoryThread"
        />
      </label>
      <button
        class="secondary-btn memory-refresh"
        @click="refreshMemory"
        :disabled="memoryLoading || !selectedMemoryThreadId"
      >
        {{ memoryLoading ? t('settings.memory.loading') : t('common.refresh') }}
      </button>
    </div>
    <p v-if="!memoryThreads.length" class="memory-empty">
      {{ t('settings.memory.noChatThreads') }}
    </p>
    <p v-if="memoryError" class="memory-error">{{ memoryError }}</p>

    <div class="memory-panel">
      <div class="memory-panel-header">
        <span>{{ t('settings.memory.affectTitle') }}</span>
      </div>
      <div v-if="affectStateLoading" class="memory-empty">
        {{ t('settings.memory.loadingAffect') }}
      </div>
      <div v-else-if="affectStateError" class="memory-error">{{ affectStateError }}</div>
      <div v-else-if="!config.memory.emotion.enabled" class="memory-empty">
        {{ t('settings.memory.emotionDisabled') }}
      </div>
      <div v-else-if="!selectedMemoryThreadId || isAllThreadsSelected" class="memory-empty">
        {{ t('settings.memory.selectThreadForAffect') }}
      </div>
      <div v-else-if="!parsedAffectState" class="memory-empty">
        {{ t('settings.memory.noAffectState') }}
      </div>
      <div v-else class="memory-item">
        <div class="memory-item-meta">
          <span class="memory-time">{{ formatTimestamp(affectStateEntry?.updated_at || '') }}</span>
        </div>
        <div class="memory-item-content">
          {{
            t('settings.memory.affectPrimary', {
              label: parsedAffectState.label,
              confidence: formatMetricDecimal(parsedAffectState.confidence),
            })
          }}
        </div>
        <div class="memory-item-sub">
          {{
            t('settings.memory.affectValenceArousal', {
              valence: formatMetricDecimal(parsedAffectState.valence),
              arousal: formatMetricDecimal(parsedAffectState.arousal),
            })
          }}
        </div>
        <div class="memory-item-sub">
          {{
            t('settings.memory.affectSamples', {
              sampleCount: parsedAffectState.sampleCount || 0,
              windowSize: parsedAffectState.windowSize || 0,
            })
          }}
        </div>
        <div class="memory-item-sub">
          {{
            t('settings.memory.affectWindow', {
              startAt: parsedAffectState.startAt || t('settings.memory.na'),
              endAt: parsedAffectState.endAt || t('settings.memory.na'),
            })
          }}
        </div>
      </div>
    </div>

    <div v-if="memoryThreads.length" class="memory-panel memory-editor">
      <div class="memory-panel-header">
        <span>{{ t('settings.memory.newLongMemory') }}</span>
      </div>
      <div class="memory-editor-grid">
        <label class="input-label">
          <span>{{ t('common.thread') }}</span>
          <SettingsSelect
            :model-value="newLongMemoryThreadId"
            :options="memoryEditorThreadOptions"
            :disabled="isMemoryThreadLocked"
            :placeholder="t('settings.memory.threadPlaceholder')"
            :empty-text="t('settings.memory.noThreadsAvailable')"
            :aria-label="t('settings.memory.editorThreadAria')"
            @update:model-value="updateNewLongMemoryThreadSelection"
          />
        </label>
        <label class="input-label">
          <span>{{ t('common.summary') }}</span>
          <textarea
            class="memory-editor-textarea"
            :value="newLongMemorySummary"
            :placeholder="t('settings.memory.summaryPlaceholder')"
            @input="newLongMemorySummary = ($event.target as HTMLTextAreaElement).value"
          />
        </label>
      </div>
      <div class="memory-editor-actions">
        <button
          class="secondary-btn"
          @click="createLongMemory"
          :disabled="memoryMutationLoading || !canCreateLongMemory"
        >
          {{ memoryMutationLoading ? t('settings.memory.saving') : t('settings.memory.addMemory') }}
        </button>
      </div>
      <p v-if="showCreateThreadHint" class="memory-empty">
        {{ t('settings.memory.chooseThreadToCreate') }}
      </p>
      <p v-if="memoryMutationError" class="memory-error">{{ memoryMutationError }}</p>
    </div>

    <div class="memory-panels">
      <div class="memory-panel">
        <div class="memory-panel-header">
          <span>{{ t('settings.memory.shortMemory') }}</span>
          <span class="memory-count">{{ shortMemoryEntries.length }}</span>
        </div>
        <div v-if="memoryLoading" class="memory-empty">
          {{ t('settings.memory.loadingShortMemory') }}
        </div>
        <div v-else-if="shortMemoryEntries.length === 0" class="memory-empty">
          {{ t('settings.memory.noShortMemory') }}
        </div>
        <ul v-else class="memory-list">
          <li v-for="entry in shortMemoryEntries" :key="entry.id" class="memory-item">
            <div class="memory-item-meta">
              <span class="memory-role">{{ formatRole(entry.role) }}</span>
              <span class="memory-time">{{ formatTimestamp(entry.updated_at) }}</span>
            </div>
            <div class="memory-item-content">{{ entry.content }}</div>
            <div v-if="isAllThreadsSelected" class="memory-item-sub">
              {{ t('common.thread') }}: {{ getThreadLabel(entry.thread_id) }}
            </div>
            <div v-if="formatJson(entry.emotion)" class="memory-item-sub">
              {{ t('settings.memory.emotion') }}: {{ formatJson(entry.emotion) }}
            </div>
          </li>
        </ul>
      </div>

      <div class="memory-panel">
        <div class="memory-panel-header">
          <span>{{ t('settings.memory.longMemory') }}</span>
          <span class="memory-count">{{ longMemoryEntries.length }}</span>
        </div>
        <div v-if="memoryLoading" class="memory-empty">
          {{ t('settings.memory.loadingLongMemory') }}
        </div>
        <div v-else-if="longMemoryEntries.length === 0" class="memory-empty">
          {{ t('settings.memory.noLongMemory') }}
        </div>
        <ul v-else class="memory-list">
          <li v-for="entry in longMemoryEntries" :key="entry.id" class="memory-item">
            <div class="memory-item-meta">
              <span class="memory-time">{{ formatTimestamp(entry.updated_at) }}</span>
            </div>
            <div v-if="editingLongMemoryId === entry.id" class="memory-edit">
              <textarea
                class="memory-editor-textarea"
                :value="editingLongMemorySummary"
                @input="editingLongMemorySummary = ($event.target as HTMLTextAreaElement).value"
              />
              <div class="memory-inline-actions">
                <button
                  class="secondary-btn memory-inline-btn"
                  @click="saveLongMemoryEdit(entry)"
                  :disabled="memoryMutationLoading || !canSaveLongMemoryEdit"
                >
                  {{ memoryMutationLoading ? t('settings.memory.saving') : t('common.save') }}
                </button>
                <button
                  class="secondary-btn memory-inline-btn"
                  @click="cancelEditLongMemory"
                  :disabled="memoryMutationLoading"
                >
                  {{ t('common.cancel') }}
                </button>
              </div>
            </div>
            <div v-else class="memory-item-content">{{ entry.summary }}</div>
            <div v-if="isAllThreadsSelected" class="memory-item-sub">
              {{ t('common.thread') }}: {{ getThreadLabel(entry.thread_id) }}
            </div>
            <div v-if="formatJsonList(entry.tags)" class="memory-item-sub">
              {{ t('settings.memory.tags') }}: {{ formatJsonList(entry.tags) }}
            </div>
            <div v-if="formatJson(entry.emotion)" class="memory-item-sub">
              {{ t('settings.memory.emotion') }}: {{ formatJson(entry.emotion) }}
            </div>
            <div v-if="editingLongMemoryId !== entry.id" class="memory-inline-actions">
              <button
                class="secondary-btn memory-inline-btn"
                @click="startEditLongMemory(entry)"
                :disabled="memoryMutationLoading"
              >
                {{ t('common.edit') }}
              </button>
              <button
                class="secondary-btn memory-inline-btn memory-danger-btn"
                @click="deleteLongMemoryEntry(entry)"
                :disabled="memoryMutationLoading"
              >
                {{ t('common.delete') }}
              </button>
            </div>
          </li>
        </ul>
      </div>
    </div>

    <div class="memory-panel">
      <div class="memory-panel-header">
        <span>{{ t('settings.memory.searchLongMemory') }}</span>
        <span v-if="memorySearchResults.length" class="memory-count">{{
          memorySearchResults.length
        }}</span>
      </div>
      <div class="memory-search">
        <input
          type="text"
          :value="memorySearchQuery"
          :placeholder="t('settings.memory.searchPlaceholder')"
          @input="memorySearchQuery = ($event.target as HTMLInputElement).value"
        />
        <button
          class="secondary-btn"
          @click="runMemorySearch"
          :disabled="memorySearchLoading || !selectedMemoryThreadId"
        >
          {{ memorySearchLoading ? t('settings.memory.searching') : t('common.search') }}
        </button>
      </div>
      <p v-if="memorySearchError" class="memory-error">{{ memorySearchError }}</p>
      <div v-if="memorySearchLoading" class="memory-empty">{{ t('settings.memory.searching') }}</div>
      <div v-else-if="!hasMemoryQuery" class="memory-empty">{{ t('settings.memory.enterQuery') }}</div>
      <div v-else-if="memorySearchResults.length === 0" class="memory-empty">
        {{ t('settings.memory.noSearchResults') }}
      </div>
      <ul v-else class="memory-list">
        <li v-for="entry in memorySearchResults" :key="entry.id" class="memory-item">
          <div class="memory-item-meta">
            <span class="memory-score">
              {{ t('settings.memory.score', { value: entry.score.toFixed(3) }) }}
            </span>
            <span class="memory-time">{{ formatTimestamp(entry.updated_at) }}</span>
          </div>
          <div class="memory-item-content">{{ entry.summary }}</div>
          <div v-if="isAllThreadsSelected" class="memory-item-sub">
            {{ t('common.thread') }}: {{ getThreadLabel(entry.thread_id) }}
          </div>
          <div v-if="formatJsonList(entry.tags)" class="memory-item-sub">
            {{ t('settings.memory.tags') }}: {{ formatJsonList(entry.tags) }}
          </div>
          <div v-if="formatJson(entry.emotion)" class="memory-item-sub">
            {{ t('settings.memory.emotion') }}: {{ formatJson(entry.emotion) }}
          </div>
        </li>
      </ul>
    </div>
  </div>
</template>

<script setup lang="ts">
import { toRef } from 'vue';
import { storeToRefs } from 'pinia';

import SettingsSelect from '../SettingsSelect.vue';
import { useI18n } from '../../../i18n';
import { useConfigStore } from '../../../store/config';
import { useSettingsMemoryViewer } from './useSettingsMemoryViewer';

const props = defineProps<{
  active: boolean;
}>();

const { t } = useI18n();
const configStore = useConfigStore();
const { config } = storeToRefs(configStore);

const {
  affectStateEntry,
  affectStateError,
  affectStateLoading,
  canCreateLongMemory,
  canSaveLongMemoryEdit,
  cancelEditLongMemory,
  createLongMemory,
  deleteLongMemoryEntry,
  editingLongMemoryId,
  editingLongMemorySummary,
  formatJson,
  formatJsonList,
  formatMetricDecimal,
  formatRole,
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
  shortMemoryEntries,
  showCreateThreadHint,
  startEditLongMemory,
  updateNewLongMemoryThreadSelection,
} = useSettingsMemoryViewer(toRef(props, 'active'));
</script>

<style scoped src="../settings_shared.css"></style>
