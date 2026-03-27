<template>
  <section class="config-section">
    <div class="settings-card">
      <div class="card-title">{{ t('settings.memory.retrievalTitle') }}</div>
      <label class="checkbox-label">
        <input
          type="checkbox"
          :checked="config.memory.enabled"
          @change="updateMemory('enabled', ($event.target as HTMLInputElement).checked)"
        />
        {{ t('settings.memory.enable') }}
      </label>
      <p class="card-help">{{ t('settings.memory.retrievalDescription') }}</p>

      <template v-if="config.memory.enabled">
        <div class="slider-field">
          <span>{{ t('settings.memory.maxRetrievedMemories') }}</span>
          <span class="value-badge">{{ config.memory.maxRetrievalCount }}</span>
        </div>
        <input
          type="range"
          min="1"
          max="20"
          :value="config.memory.maxRetrievalCount"
          @input="
            updateMemory('maxRetrievalCount', parseInt(($event.target as HTMLInputElement).value))
          "
        />
        <p class="slider-hint">{{ t('settings.memory.maxRetrievedHint') }}</p>

        <div class="slider-field">
          <span>{{ t('settings.memory.similarityThreshold') }}</span>
          <span class="value-badge">{{ Math.round(config.memory.similarThreshold * 100) }}%</span>
        </div>
        <input
          type="range"
          min="0"
          max="100"
          step="1"
          :value="Math.round(config.memory.similarThreshold * 100)"
          @input="
            updateMemory(
              'similarThreshold',
              parseInt(($event.target as HTMLInputElement).value) / 100
            )
          "
        />
        <div class="slider-legend">
          <span>{{ t('settings.memory.loose') }}</span>
          <span>{{ t('settings.memory.strict') }}</span>
        </div>
        <p class="slider-hint">{{ t('settings.memory.similarityHint') }}</p>
      </template>
    </div>

    <div class="settings-card">
      <div class="card-title">{{ t('settings.memory.summarizationTitle') }}</div>
      <label class="checkbox-label">
        <input
          type="checkbox"
          :checked="config.memory.autoSummarize"
          @change="updateMemory('autoSummarize', ($event.target as HTMLInputElement).checked)"
        />
        {{ t('settings.memory.autoSummarize') }}
      </label>
      <p class="card-help">{{ t('settings.memory.summarizationDescription') }}</p>
    </div>

    <div class="settings-card">
      <div class="card-title">{{ t('settings.memory.contextTitle') }}</div>
      <label class="checkbox-label">
        <input
          type="checkbox"
          :checked="config.memory.context.enabled"
          @change="updateMemoryContext('enabled', ($event.target as HTMLInputElement).checked)"
        />
        {{ t('settings.memory.contextEnable') }}
      </label>
      <p class="card-help">{{ t('settings.memory.contextDescription') }}</p>

      <template v-if="config.memory.context.enabled">
        <label class="input-label">
          <span>{{ t('settings.memory.recentRawMessages') }}</span>
          <input
            type="number"
            min="2"
            max="20"
            :value="config.memory.context.recentMessageCount"
            @input="
              updateMemoryContext(
                'recentMessageCount',
                parseInt(($event.target as HTMLInputElement).value || '0')
              )
            "
          />
        </label>
        <label class="input-label">
          <span>{{ t('settings.memory.recentHistoryBudget') }}</span>
          <input
            type="number"
            min="200"
            max="12000"
            step="100"
            :value="config.memory.context.maxRecentTokens"
            @input="
              updateMemoryContext(
                'maxRecentTokens',
                parseInt(($event.target as HTMLInputElement).value || '0')
              )
            "
          />
        </label>
        <label class="input-label">
          <span>{{ t('settings.memory.summaryTriggerMessages') }}</span>
          <input
            type="number"
            min="4"
            max="100"
            :value="config.memory.context.summaryTriggerMessages"
            @input="
              updateMemoryContext(
                'summaryTriggerMessages',
                parseInt(($event.target as HTMLInputElement).value || '0')
              )
            "
          />
        </label>
        <label class="input-label">
          <span>{{ t('settings.memory.recentExcludedFromSummary') }}</span>
          <input
            type="number"
            min="2"
            max="20"
            :value="config.memory.context.summaryRecentMessages"
            @input="
              updateMemoryContext(
                'summaryRecentMessages',
                parseInt(($event.target as HTMLInputElement).value || '0')
              )
            "
          />
        </label>
        <label class="input-label">
          <span>{{ t('settings.memory.threadSummaryBudget') }}</span>
          <input
            type="number"
            min="100"
            max="4000"
            step="50"
            :value="config.memory.context.maxSummaryTokens"
            @input="
              updateMemoryContext(
                'maxSummaryTokens',
                parseInt(($event.target as HTMLInputElement).value || '0')
              )
            "
          />
        </label>
        <label class="input-label">
          <span>{{ t('settings.memory.memoryBudget') }}</span>
          <input
            type="number"
            min="100"
            max="4000"
            step="50"
            :value="config.memory.context.maxMemoryTokens"
            @input="
              updateMemoryContext(
                'maxMemoryTokens',
                parseInt(($event.target as HTMLInputElement).value || '0')
              )
            "
          />
        </label>
        <label class="input-label">
          <span>{{ t('settings.memory.skillBudget') }}</span>
          <input
            type="number"
            min="100"
            max="8000"
            step="50"
            :value="config.memory.context.maxSkillTokens"
            @input="
              updateMemoryContext(
                'maxSkillTokens',
                parseInt(($event.target as HTMLInputElement).value || '0')
              )
            "
          />
        </label>
      </template>
    </div>

    <div class="settings-card">
      <div class="card-title">{{ t('settings.memory.emotionTitle') }}</div>
      <label class="checkbox-label">
        <input
          type="checkbox"
          :checked="config.memory.emotion.enabled"
          @change="updateEmotion('enabled', ($event.target as HTMLInputElement).checked)"
        />
        {{ t('settings.memory.emotionEnable') }}
      </label>
      <p class="card-help">{{ t('settings.memory.emotionDescription') }}</p>

      <template v-if="config.memory.emotion.enabled">
        <label class="checkbox-label">
          <input
            type="checkbox"
            :checked="config.memory.emotion.injectToSystemPrompt"
            @change="
              updateEmotion('injectToSystemPrompt', ($event.target as HTMLInputElement).checked)
            "
          />
          {{ t('settings.memory.injectEmotionToAgent') }}
        </label>

        <label class="checkbox-label">
          <input
            type="checkbox"
            :checked="config.memory.emotion.realtimeAnalysis"
            @change="updateEmotion('realtimeAnalysis', ($event.target as HTMLInputElement).checked)"
          />
          {{ t('settings.memory.realtimeAnalysis') }}
        </label>
        <p class="card-help">{{ t('settings.memory.realtimeDescription') }}</p>

        <div class="slider-field">
          <span>{{ t('settings.memory.minimumConfidence') }}</span>
          <span class="value-badge"
            >{{ Math.round(config.memory.emotion.minConfidence * 100) }}%</span
          >
        </div>
        <input
          type="range"
          min="0"
          max="100"
          step="1"
          :value="Math.round(config.memory.emotion.minConfidence * 100)"
          @input="
            updateEmotion(
              'minConfidence',
              parseInt(($event.target as HTMLInputElement).value) / 100
            )
          "
        />
        <p class="slider-hint">{{ t('settings.memory.higherValuesConservative') }}</p>

        <div class="slider-field">
          <span>{{ t('settings.memory.minimumSamples') }}</span>
          <span class="value-badge">{{ config.memory.emotion.minSampleCount }}</span>
        </div>
        <input
          type="range"
          min="1"
          max="8"
          step="1"
          :value="config.memory.emotion.minSampleCount"
          @input="
            updateEmotion('minSampleCount', parseInt(($event.target as HTMLInputElement).value))
          "
        />

        <div class="slider-field">
          <span>{{ t('settings.memory.windowSize') }}</span>
          <span class="value-badge">{{ config.memory.emotion.windowSize }}</span>
        </div>
        <input
          type="range"
          min="1"
          max="20"
          step="1"
          :value="config.memory.emotion.windowSize"
          @input="updateEmotion('windowSize', parseInt(($event.target as HTMLInputElement).value))"
        />
        <p class="slider-hint">{{ t('settings.memory.windowSizeHint') }}</p>

        <label class="input-label">
          <span>{{ t('settings.memory.halfLifeMinutes') }}</span>
          <input
            type="number"
            min="5"
            max="720"
            :value="config.memory.emotion.halfLifeMinutes"
            @input="
              updateEmotion(
                'halfLifeMinutes',
                parseInt(($event.target as HTMLInputElement).value || '0')
              )
            "
          />
        </label>

        <label class="input-label">
          <span>{{ t('settings.memory.maxAgeMinutes') }}</span>
          <input
            type="number"
            min="10"
            max="1440"
            :value="config.memory.emotion.maxAgeMinutes"
            @input="
              updateEmotion(
                'maxAgeMinutes',
                parseInt(($event.target as HTMLInputElement).value || '0')
              )
            "
          />
        </label>

        <label class="checkbox-label">
          <input
            type="checkbox"
            :checked="config.memory.emotion.includeNeutral"
            @change="updateEmotion('includeNeutral', ($event.target as HTMLInputElement).checked)"
          />
          {{ t('settings.memory.includeNeutralSignals') }}
        </label>
      </template>
    </div>

    <div v-if="config.memory.emotion.enabled" class="settings-card">
      <div class="card-title">{{ t('settings.memory.toolGuardTitle') }}</div>
      <label class="checkbox-label">
        <input
          type="checkbox"
          :checked="config.memory.emotion.toolGuard.enabled"
          @change="updateEmotionGuard('enabled', ($event.target as HTMLInputElement).checked)"
        />
        {{ t('settings.memory.toolGuardEnable') }}
      </label>
      <p class="card-help">{{ t('settings.memory.toolGuardDescription') }}</p>

      <template v-if="config.memory.emotion.toolGuard.enabled">
        <label class="checkbox-label">
          <input
            type="checkbox"
            :checked="config.memory.emotion.toolGuard.requireApproval"
            @change="
              updateEmotionGuard('requireApproval', ($event.target as HTMLInputElement).checked)
            "
          />
          {{ t('settings.memory.toolGuardRequireApproval') }}
        </label>

        <label class="checkbox-label">
          <input
            type="checkbox"
            :checked="config.memory.emotion.toolGuard.disableAutoTools"
            @change="
              updateEmotionGuard('disableAutoTools', ($event.target as HTMLInputElement).checked)
            "
          />
          {{ t('settings.memory.toolGuardDisableAuto') }}
        </label>

        <div class="slider-field">
          <span>{{ t('settings.memory.toolGuardConfidenceThreshold') }}</span>
          <span class="value-badge">
            {{ Math.round(config.memory.emotion.toolGuard.minConfidence * 100) }}%
          </span>
        </div>
        <input
          type="range"
          min="0"
          max="100"
          step="1"
          :value="Math.round(config.memory.emotion.toolGuard.minConfidence * 100)"
          @input="
            updateEmotionGuard(
              'minConfidence',
              parseInt(($event.target as HTMLInputElement).value) / 100
            )
          "
        />

        <div class="slider-field">
          <span>{{ t('settings.memory.toolGuardArousalThreshold') }}</span>
          <span class="value-badge">
            {{ Math.round(config.memory.emotion.toolGuard.minArousal * 100) }}%
          </span>
        </div>
        <input
          type="range"
          min="0"
          max="100"
          step="1"
          :value="Math.round(config.memory.emotion.toolGuard.minArousal * 100)"
          @input="
            updateEmotionGuard(
              'minArousal',
              parseInt(($event.target as HTMLInputElement).value) / 100
            )
          "
        />

        <div class="slider-field">
          <span>{{ t('settings.memory.toolGuardValenceThreshold') }}</span>
          <span class="value-badge">
            {{ Math.round(config.memory.emotion.toolGuard.maxValence * 100) }}%
          </span>
        </div>
        <input
          type="range"
          min="-100"
          max="0"
          step="1"
          :value="Math.round(config.memory.emotion.toolGuard.maxValence * 100)"
          @input="
            updateEmotionGuard(
              'maxValence',
              parseInt(($event.target as HTMLInputElement).value) / 100
            )
          "
        />
      </template>
    </div>

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
            <span class="memory-time">{{
              formatTimestamp(affectStateEntry?.updated_at || '')
            }}</span>
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
            {{
              memoryMutationLoading ? t('settings.memory.saving') : t('settings.memory.addMemory')
            }}
          </button>
        </div>
        <p
          v-if="selectedMemoryThreadId === ALL_THREADS && !newLongMemoryThreadId"
          class="memory-empty"
        >
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

    <div class="config-actions">
      <button class="reset-btn" type="button" @click="emit('reset')">
        {{ t('settings.memory.reset') }}
      </button>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';

import SettingsSelect from './SettingsSelect.vue';
import { useI18n } from '../../i18n';
import { useConfigStore } from '../../store/config';
import type { AppConfig } from '../../../shared/types/config';
import type { ChatThread } from '../../../shared/types/chat';
import type {
  AffectStateEntry,
  LongMemoryEntry,
  LongMemorySearchResult,
  ShortMemoryEntry,
} from '../../../shared/types/memory';
import { getErrorMessage } from '../../../shared/utils/errors';
import {
  formatJson,
  formatJsonList,
  formatTimestamp,
  parseAffectStateSnapshot,
} from './settings_formatters';
import { getElectronAPI } from '../../services/electron_api';

const emit = defineEmits<{
  (event: 'config-change'): void;
  (event: 'reset'): void;
}>();

const props = defineProps<{
  active: boolean;
}>();
const electronAPI = getElectronAPI();
const { t } = useI18n();

const ALL_THREADS = '__all__';

const configStore = useConfigStore();
const { config } = storeToRefs(configStore);

const memoryThreads = ref<ChatThread[]>([]);
const selectedMemoryThreadId = ref('');
const shortMemoryEntries = ref<ShortMemoryEntry[]>([]);
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

const updateMemory = <K extends keyof AppConfig['memory']>(
  key: K,
  value: AppConfig['memory'][K]
) => {
  config.value.memory[key] = value;
  emit('config-change');
};

const updateMemoryContext = <K extends keyof AppConfig['memory']['context']>(
  key: K,
  value: AppConfig['memory']['context'][K]
) => {
  config.value.memory.context[key] = value;
  emit('config-change');
};

const updateEmotion = <K extends keyof AppConfig['memory']['emotion']>(
  key: K,
  value: AppConfig['memory']['emotion'][K]
) => {
  config.value.memory.emotion[key] = value;
  emit('config-change');
};

const updateEmotionGuard = <K extends keyof AppConfig['memory']['emotion']['toolGuard']>(
  key: K,
  value: AppConfig['memory']['emotion']['toolGuard'][K]
) => {
  config.value.memory.emotion.toolGuard[key] = value;
  emit('config-change');
};

const hasMemoryQuery = computed(() => memorySearchQuery.value.trim().length > 0);
const isAllThreadsSelected = computed(() => selectedMemoryThreadId.value === ALL_THREADS);
const parsedAffectState = computed(() => parseAffectStateSnapshot(affectStateEntry.value?.state));
const isMemoryThreadLocked = computed(
  () => !!selectedMemoryThreadId.value && selectedMemoryThreadId.value !== ALL_THREADS
);
const canCreateLongMemory = computed(
  () =>
    newLongMemorySummary.value.trim().length > 0 && newLongMemoryThreadId.value.trim().length > 0
);
const canSaveLongMemoryEdit = computed(() => {
  if (!editingLongMemoryId.value) return false;
  const summary = editingLongMemorySummary.value.trim();
  return summary.length > 0 && summary !== editingLongMemoryOriginal.value.trim();
});

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

const formatRole = (role: string) => {
  if (!role) return t('common.unknown');
  if (role === 'user') return t('settings.memory.role.user');
  if (role === 'assistant') return t('settings.memory.role.assistant');
  if (role === 'system') return t('settings.memory.role.system');
  if (role === 'tool') return t('settings.memory.role.tool');
  return role;
};

const formatMetricDecimal = (value: unknown, digits = 2): string => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return t('settings.memory.na');
  return value.toFixed(digits);
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
    editingLongMemoryId.value = '';
    editingLongMemorySummary.value = '';
    editingLongMemoryOriginal.value = '';
  }
  await refreshMemory();
};

const updateNewLongMemoryThreadSelection = (threadId: string) => {
  newLongMemoryThreadId.value = threadId;
};

const refreshMemory = async () => {
  if (!selectedMemoryThreadId.value) return;
  memoryLoading.value = true;
  memoryError.value = '';
  affectStateLoading.value = true;
  affectStateError.value = '';
  try {
    const shouldFetchAffect = !isAllThreadsSelected.value;
    const [shortEntries, longEntries, affectEntry] = isAllThreadsSelected.value
      ? await Promise.all([
          electronAPI.memory.short.listAll(50),
          electronAPI.memory.long.listAll(25),
          Promise.resolve(null),
        ])
      : await Promise.all([
          electronAPI.memory.short.list(selectedMemoryThreadId.value, 50),
          electronAPI.memory.long.list(selectedMemoryThreadId.value, 25),
          shouldFetchAffect
            ? electronAPI.memory.affect.get(selectedMemoryThreadId.value)
            : Promise.resolve(null),
        ]);
    shortMemoryEntries.value = Array.isArray(shortEntries) ? shortEntries : [];
    longMemoryEntries.value = Array.isArray(longEntries) ? longEntries : [];
    affectStateEntry.value = affectEntry || null;
    if (
      editingLongMemoryId.value &&
      !longMemoryEntries.value.some(entry => entry.id === editingLongMemoryId.value)
    ) {
      editingLongMemoryId.value = '';
      editingLongMemorySummary.value = '';
      editingLongMemoryOriginal.value = '';
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
    const results = isAllThreadsSelected.value
      ? await electronAPI.memory.long.searchAll(memorySearchQuery.value.trim(), {
          limit: config.value.memory.maxRetrievalCount,
          threshold: config.value.memory.similarThreshold,
          force: true,
        })
      : await electronAPI.memory.long.search(
          selectedMemoryThreadId.value,
          memorySearchQuery.value.trim(),
          {
            limit: config.value.memory.maxRetrievalCount,
            threshold: config.value.memory.similarThreshold,
            force: true,
          }
        );
    memorySearchResults.value = Array.isArray(results) ? results : [];
  } catch (error: unknown) {
    memorySearchError.value = t('settings.memory.error.searchFailed', {
      error: getErrorMessage(error),
    });
  } finally {
    memorySearchLoading.value = false;
  }
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
  editingLongMemoryId.value = '';
  editingLongMemorySummary.value = '';
  editingLongMemoryOriginal.value = '';
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
  () => props.active,
  active => {
    if (active) {
      void loadMemoryThreads();
    }
  },
  { immediate: true }
);
</script>

<style scoped src="./settings_shared.css"></style>

<style scoped>
.memory-viewer .card-help {
  margin-bottom: 12px;
}

.memory-controls {
  display: flex;
  gap: 12px;
  align-items: flex-end;
  flex-wrap: wrap;
  margin-bottom: 12px;
}

.memory-controls .input-label {
  flex: 1;
  min-width: 220px;
  margin-bottom: 0;
}

.memory-refresh {
  min-height: 38px;
}

.memory-panels {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 16px;
  margin: 16px 0;
}

.memory-panel {
  border: 1px solid var(--border-color);
  border-radius: 10px;
  background: var(--bg-secondary);
  padding: 12px;
}

.memory-editor {
  margin-bottom: 12px;
}

.memory-editor-grid {
  display: grid;
  gap: 12px;
}

.memory-editor-textarea {
  width: 100%;
  min-height: 74px;
  padding: 8px 12px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background: var(--bg-primary);
  color: var(--text-primary);
  resize: vertical;
}

.memory-editor-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 8px;
}

.memory-edit {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.memory-panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-weight: 600;
  margin-bottom: 10px;
}

.memory-count {
  font-size: 12px;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--bg-tertiary);
  color: var(--text-secondary);
}

.memory-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-height: 260px;
  overflow-y: auto;
}

.memory-item {
  border: 1px solid var(--border-color);
  border-radius: 8px;
  padding: 8px 10px;
  background: var(--bg-tertiary);
}

.memory-item-meta {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  font-size: 11px;
  color: var(--text-secondary);
  margin-bottom: 6px;
}

.memory-item-content {
  font-size: 13px;
  color: var(--text-primary);
  white-space: pre-wrap;
  word-break: break-word;
}

.memory-item-sub {
  font-size: 11px;
  color: var(--text-muted);
  margin-top: 6px;
}

.memory-inline-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 8px;
}

.memory-inline-btn {
  padding: 4px 10px;
  font-size: 11px;
  border-radius: 6px;
}

.memory-danger-btn {
  border-color: color-mix(in srgb, var(--danger-color) 45%, var(--border-color));
  color: var(--danger-color);
}

.memory-danger-btn:hover {
  background: color-mix(in srgb, var(--danger-color) 12%, var(--bg-primary));
  border-color: var(--danger-color);
}

.memory-search {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-bottom: 10px;
}

.memory-search input {
  flex: 1;
  padding: 8px 12px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background: var(--bg-primary);
  color: var(--text-primary);
}

.memory-empty {
  font-size: 12px;
  color: var(--text-muted);
  margin: 6px 0;
}

.memory-error {
  font-size: 12px;
  color: var(--danger-color);
  margin-bottom: 8px;
}
</style>
