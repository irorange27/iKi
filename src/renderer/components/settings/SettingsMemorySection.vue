<template>
  <section class="config-section">
    <div class="settings-card">
      <div class="card-title">Memory Retrieval</div>
      <label class="checkbox-label">
        <input
          type="checkbox"
          :checked="config.memory.enabled"
          @change="updateMemory('enabled', ($event.target as HTMLInputElement).checked)"
        />
        Enable Memory
      </label>
      <p class="card-help">Long-term memory is injected automatically when Memory is enabled.</p>

      <template v-if="config.memory.enabled">
        <div class="slider-field">
          <span>Max Retrieved Memories</span>
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
        <p class="slider-hint">
          Maximum number of relevant memories injected into the conversation context (1-20).
        </p>

        <div class="slider-field">
          <span>Similarity Threshold</span>
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
          <span>Loose (0%)</span>
          <span>Strict (100%)</span>
        </div>
        <p class="slider-hint">
          Minimum similarity score required for a memory to be retrieved. Higher values mean
          stricter matching.
        </p>
      </template>
    </div>

    <div class="settings-card">
      <div class="card-title">Memory Summarization</div>
      <label class="checkbox-label">
        <input
          type="checkbox"
          :checked="config.memory.autoSummarize"
          @change="updateMemory('autoSummarize', ($event.target as HTMLInputElement).checked)"
        />
        Auto Summarize Conversations
      </label>
      <p class="card-help">
        Automatically extract and store important information from conversations as new memories.
      </p>
    </div>

    <div class="settings-card">
      <div class="card-title">Context Assembly</div>
      <label class="checkbox-label">
        <input
          type="checkbox"
          :checked="config.memory.context.enabled"
          @change="updateMemoryContext('enabled', ($event.target as HTMLInputElement).checked)"
        />
        Enable Context Budgeting
      </label>
      <p class="card-help">
        Compact long threads into a rolling summary plus recent turns, and bound skill / memory
        context by estimated token budgets.
      </p>

      <template v-if="config.memory.context.enabled">
        <label class="input-label">
          <span>Recent Raw Messages</span>
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
          <span>Recent History Budget (tokens)</span>
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
          <span>Summary Trigger Messages</span>
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
          <span>Recent Messages Excluded From Summary</span>
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
          <span>Thread Summary Budget (tokens)</span>
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
          <span>Memory Budget (tokens)</span>
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
          <span>Skill Budget (tokens)</span>
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
      <div class="card-title">Emotion Context</div>
      <label class="checkbox-label">
        <input
          type="checkbox"
          :checked="config.memory.emotion.enabled"
          @change="updateEmotion('enabled', ($event.target as HTMLInputElement).checked)"
        />
        Enable Emotion Analysis
      </label>
      <p class="card-help">
        Infer affect signals from recent user messages to guide tone and pacing. Emotion events are
        stored without message content.
      </p>

      <template v-if="config.memory.emotion.enabled">
        <label class="checkbox-label">
          <input
            type="checkbox"
            :checked="config.memory.emotion.injectToSystemPrompt"
            @change="
              updateEmotion('injectToSystemPrompt', ($event.target as HTMLInputElement).checked)
            "
          />
          Inject Emotion Context into Agent
        </label>

        <label class="checkbox-label">
          <input
            type="checkbox"
            :checked="config.memory.emotion.realtimeAnalysis"
            @change="updateEmotion('realtimeAnalysis', ($event.target as HTMLInputElement).checked)"
          />
          Analyze Current Message Before Reply (adds latency)
        </label>
        <p class="card-help">
          Runs one extra model call to include the user's current affect in this response.
        </p>

        <div class="slider-field">
          <span>Minimum Confidence</span>
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
        <p class="slider-hint">Higher values make emotion context more conservative.</p>

        <div class="slider-field">
          <span>Minimum Samples</span>
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
          <span>Window Size</span>
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
        <p class="slider-hint">Number of recent messages used to compute affect state.</p>

        <label class="input-label">
          <span>Half-life (minutes)</span>
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
          <span>Max Age (minutes)</span>
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
          Include Neutral Signals
        </label>
      </template>
    </div>

    <div v-if="config.memory.emotion.enabled" class="settings-card">
      <div class="card-title">Tool Guardrails</div>
      <label class="checkbox-label">
        <input
          type="checkbox"
          :checked="config.memory.emotion.toolGuard.enabled"
          @change="updateEmotionGuard('enabled', ($event.target as HTMLInputElement).checked)"
        />
        Enable Affect-based Guardrails
      </label>
      <p class="card-help">
        When high arousal and negative valence are detected, require approvals or suppress auto
        tools.
      </p>

      <template v-if="config.memory.emotion.toolGuard.enabled">
        <label class="checkbox-label">
          <input
            type="checkbox"
            :checked="config.memory.emotion.toolGuard.requireApproval"
            @change="
              updateEmotionGuard('requireApproval', ($event.target as HTMLInputElement).checked)
            "
          />
          Require Approval for All Tools
        </label>

        <label class="checkbox-label">
          <input
            type="checkbox"
            :checked="config.memory.emotion.toolGuard.disableAutoTools"
            @change="
              updateEmotionGuard('disableAutoTools', ($event.target as HTMLInputElement).checked)
            "
          />
          Disable Auto Tools When Guarded
        </label>

        <div class="slider-field">
          <span>Guard Confidence Threshold</span>
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
          <span>Guard Arousal Threshold</span>
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
          <span>Guard Valence Threshold</span>
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
      <div class="card-title">Memory Viewer</div>
      <p class="card-help">
        View short-term and long-term memory entries by chat thread or across all threads, plus
        long-memory search results.
      </p>
      <div class="memory-controls">
        <label class="input-label">
          <span>Thread</span>
          <select
            :value="selectedMemoryThreadId"
            @change="selectMemoryThread(($event.target as HTMLSelectElement).value)"
          >
            <option value="" disabled>Select a thread</option>
            <option :value="ALL_THREADS">All threads</option>
            <option v-for="thread in memoryThreads" :key="thread.id" :value="thread.id">
              {{ thread.title || thread.id }}
            </option>
          </select>
        </label>
        <button
          class="secondary-btn memory-refresh"
          @click="refreshMemory"
          :disabled="memoryLoading || !selectedMemoryThreadId"
        >
          {{ memoryLoading ? 'Loading...' : 'Refresh' }}
        </button>
      </div>
      <p v-if="!memoryThreads.length" class="memory-empty">
        No chat threads yet. Start a chat to generate memory entries.
      </p>
      <p v-if="memoryError" class="memory-error">{{ memoryError }}</p>

      <div class="memory-panel">
        <div class="memory-panel-header">
          <span>Affect State</span>
        </div>
        <div v-if="affectStateLoading" class="memory-empty">Loading affect state...</div>
        <div v-else-if="affectStateError" class="memory-error">{{ affectStateError }}</div>
        <div v-else-if="!config.memory.emotion.enabled" class="memory-empty">
          Emotion analysis is disabled.
        </div>
        <div v-else-if="!selectedMemoryThreadId || isAllThreadsSelected" class="memory-empty">
          Select a thread to view affect state.
        </div>
        <div v-else-if="!parsedAffectState" class="memory-empty">No affect state yet.</div>
        <div v-else class="memory-item">
          <div class="memory-item-meta">
            <span class="memory-time">{{
              formatTimestamp(affectStateEntry?.updated_at || '')
            }}</span>
          </div>
          <div class="memory-item-content">
            Primary: {{ parsedAffectState.label }} (confidence
            {{ formatDecimal(parsedAffectState.confidence) }})
          </div>
          <div class="memory-item-sub">
            Valence: {{ formatDecimal(parsedAffectState.valence) }} · Arousal:
            {{ formatDecimal(parsedAffectState.arousal) }}
          </div>
          <div class="memory-item-sub">
            Samples: {{ parsedAffectState.sampleCount || 0 }} /
            {{ parsedAffectState.windowSize || 0 }}
          </div>
          <div class="memory-item-sub">
            Window: {{ parsedAffectState.startAt || 'n/a' }} →
            {{ parsedAffectState.endAt || 'n/a' }}
          </div>
        </div>
      </div>

      <div v-if="memoryThreads.length" class="memory-panel memory-editor">
        <div class="memory-panel-header">
          <span>New Long Memory</span>
        </div>
        <div class="memory-editor-grid">
          <label class="input-label">
            <span>Thread</span>
            <select
              :value="newLongMemoryThreadId"
              :disabled="isMemoryThreadLocked"
              @change="newLongMemoryThreadId = ($event.target as HTMLSelectElement).value"
            >
              <option value="" disabled>Select a thread</option>
              <option v-for="thread in memoryThreads" :key="thread.id" :value="thread.id">
                {{ thread.title || thread.id }}
              </option>
            </select>
          </label>
          <label class="input-label">
            <span>Summary</span>
            <textarea
              class="memory-editor-textarea"
              :value="newLongMemorySummary"
              placeholder="Add a durable user fact, preference, or project detail."
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
            {{ memoryMutationLoading ? 'Saving...' : 'Add Memory' }}
          </button>
        </div>
        <p
          v-if="selectedMemoryThreadId === ALL_THREADS && !newLongMemoryThreadId"
          class="memory-empty"
        >
          Choose a thread to enable manual memory creation.
        </p>
        <p v-if="memoryMutationError" class="memory-error">{{ memoryMutationError }}</p>
      </div>

      <div class="memory-panels">
        <div class="memory-panel">
          <div class="memory-panel-header">
            <span>Short Memory</span>
            <span class="memory-count">{{ shortMemoryEntries.length }}</span>
          </div>
          <div v-if="memoryLoading" class="memory-empty">Loading short memory...</div>
          <div v-else-if="shortMemoryEntries.length === 0" class="memory-empty">
            No short-term memory entries.
          </div>
          <ul v-else class="memory-list">
            <li v-for="entry in shortMemoryEntries" :key="entry.id" class="memory-item">
              <div class="memory-item-meta">
                <span class="memory-role">{{ formatRole(entry.role) }}</span>
                <span class="memory-time">{{ formatTimestamp(entry.updated_at) }}</span>
              </div>
              <div class="memory-item-content">{{ entry.content }}</div>
              <div v-if="isAllThreadsSelected" class="memory-item-sub">
                Thread: {{ getThreadLabel(entry.thread_id) }}
              </div>
              <div v-if="formatJson(entry.emotion)" class="memory-item-sub">
                Emotion: {{ formatJson(entry.emotion) }}
              </div>
            </li>
          </ul>
        </div>

        <div class="memory-panel">
          <div class="memory-panel-header">
            <span>Long Memory</span>
            <span class="memory-count">{{ longMemoryEntries.length }}</span>
          </div>
          <div v-if="memoryLoading" class="memory-empty">Loading long memory...</div>
          <div v-else-if="longMemoryEntries.length === 0" class="memory-empty">
            No long-term memory entries.
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
                    {{ memoryMutationLoading ? 'Saving...' : 'Save' }}
                  </button>
                  <button
                    class="secondary-btn memory-inline-btn"
                    @click="cancelEditLongMemory"
                    :disabled="memoryMutationLoading"
                  >
                    Cancel
                  </button>
                </div>
              </div>
              <div v-else class="memory-item-content">{{ entry.summary }}</div>
              <div v-if="isAllThreadsSelected" class="memory-item-sub">
                Thread: {{ getThreadLabel(entry.thread_id) }}
              </div>
              <div v-if="formatJsonList(entry.tags)" class="memory-item-sub">
                Tags: {{ formatJsonList(entry.tags) }}
              </div>
              <div v-if="formatJson(entry.emotion)" class="memory-item-sub">
                Emotion: {{ formatJson(entry.emotion) }}
              </div>
              <div v-if="editingLongMemoryId !== entry.id" class="memory-inline-actions">
                <button
                  class="secondary-btn memory-inline-btn"
                  @click="startEditLongMemory(entry)"
                  :disabled="memoryMutationLoading"
                >
                  Edit
                </button>
                <button
                  class="secondary-btn memory-inline-btn memory-danger-btn"
                  @click="deleteLongMemoryEntry(entry)"
                  :disabled="memoryMutationLoading"
                >
                  Delete
                </button>
              </div>
            </li>
          </ul>
        </div>
      </div>

      <div class="memory-panel">
        <div class="memory-panel-header">
          <span>Search Long Memory</span>
          <span v-if="memorySearchResults.length" class="memory-count">{{
            memorySearchResults.length
          }}</span>
        </div>
        <div class="memory-search">
          <input
            type="text"
            :value="memorySearchQuery"
            placeholder="Search long memory..."
            @input="memorySearchQuery = ($event.target as HTMLInputElement).value"
          />
          <button
            class="secondary-btn"
            @click="runMemorySearch"
            :disabled="memorySearchLoading || !selectedMemoryThreadId"
          >
            {{ memorySearchLoading ? 'Searching...' : 'Search' }}
          </button>
        </div>
        <p v-if="memorySearchError" class="memory-error">{{ memorySearchError }}</p>
        <div v-if="memorySearchLoading" class="memory-empty">Searching...</div>
        <div v-else-if="!hasMemoryQuery" class="memory-empty">Enter a query to search.</div>
        <div v-else-if="memorySearchResults.length === 0" class="memory-empty">
          No search results.
        </div>
        <ul v-else class="memory-list">
          <li v-for="entry in memorySearchResults" :key="entry.id" class="memory-item">
            <div class="memory-item-meta">
              <span class="memory-score">Score {{ entry.score.toFixed(3) }}</span>
              <span class="memory-time">{{ formatTimestamp(entry.updated_at) }}</span>
            </div>
            <div class="memory-item-content">{{ entry.summary }}</div>
            <div v-if="isAllThreadsSelected" class="memory-item-sub">
              Thread: {{ getThreadLabel(entry.thread_id) }}
            </div>
            <div v-if="formatJsonList(entry.tags)" class="memory-item-sub">
              Tags: {{ formatJsonList(entry.tags) }}
            </div>
            <div v-if="formatJson(entry.emotion)" class="memory-item-sub">
              Emotion: {{ formatJson(entry.emotion) }}
            </div>
          </li>
        </ul>
      </div>
    </div>

    <div class="config-actions">
      <button class="reset-btn" type="button" @click="emit('reset')">Reset Memory</button>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';

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
  formatDecimal,
  formatJson,
  formatJsonList,
  formatTimestamp,
  parseAffectStateSnapshot,
} from './settings_formatters';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const window: any;

const emit = defineEmits<{
  (event: 'config-change'): void;
  (event: 'reset'): void;
}>();

const props = defineProps<{
  active: boolean;
}>();

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

const getThreadLabel = (threadId?: string): string => {
  if (!threadId) return 'Unknown thread';
  return threadLabelMap.value.get(threadId) || threadId;
};

const formatRole = (role: string) => {
  if (!role) return 'Unknown';
  return role.charAt(0).toUpperCase() + role.slice(1);
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
    const threads = await window.electronAPI.chat.threads.list();
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
    memoryError.value = `Failed to load threads: ${getErrorMessage(error)}`;
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
          window.electronAPI.memory.short.listAll(50),
          window.electronAPI.memory.long.listAll(25),
          Promise.resolve(null),
        ])
      : await Promise.all([
          window.electronAPI.memory.short.list(selectedMemoryThreadId.value, 50),
          window.electronAPI.memory.long.list(selectedMemoryThreadId.value, 25),
          shouldFetchAffect
            ? window.electronAPI.memory.affect.get(selectedMemoryThreadId.value)
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
    memoryError.value = `Failed to load memory: ${message}`;
    affectStateError.value = `Failed to load affect state: ${message}`;
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
      ? await window.electronAPI.memory.long.searchAll(memorySearchQuery.value.trim(), {
          limit: config.value.memory.maxRetrievalCount,
          threshold: config.value.memory.similarThreshold,
          force: true,
        })
      : await window.electronAPI.memory.long.search(
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
    memorySearchError.value = `Search failed: ${getErrorMessage(error)}`;
  } finally {
    memorySearchLoading.value = false;
  }
};

const createLongMemory = async () => {
  const threadId = newLongMemoryThreadId.value.trim();
  const summary = newLongMemorySummary.value.trim();
  if (!threadId) {
    memoryMutationError.value = 'Select a thread for the new memory.';
    return;
  }
  if (!summary) {
    memoryMutationError.value = 'Summary cannot be empty.';
    return;
  }

  memoryMutationLoading.value = true;
  memoryMutationError.value = '';
  try {
    await window.electronAPI.memory.long.add({
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
    memoryMutationError.value = `Failed to add memory: ${getErrorMessage(error)}`;
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
    memoryMutationError.value = 'Summary cannot be empty.';
    return;
  }
  if (summary === editingLongMemoryOriginal.value.trim()) {
    cancelEditLongMemory();
    return;
  }

  memoryMutationLoading.value = true;
  memoryMutationError.value = '';
  try {
    await window.electronAPI.memory.long.update(entry.id, { summary });
    await refreshMemory();
    if (hasMemoryQuery.value) {
      await runMemorySearch();
    }
    cancelEditLongMemory();
  } catch (error: unknown) {
    memoryMutationError.value = `Failed to update memory: ${getErrorMessage(error)}`;
  } finally {
    memoryMutationLoading.value = false;
  }
};

const deleteLongMemoryEntry = async (entry: LongMemoryEntry) => {
  if (!entry?.id) return;
  if (!window.confirm('Delete this long-term memory? This cannot be undone.')) return;

  memoryMutationLoading.value = true;
  memoryMutationError.value = '';
  try {
    await window.electronAPI.memory.long.delete(entry.id);
    if (editingLongMemoryId.value === entry.id) {
      cancelEditLongMemory();
    }
    await refreshMemory();
    if (hasMemoryQuery.value) {
      await runMemorySearch();
    }
  } catch (error: unknown) {
    memoryMutationError.value = `Failed to delete memory: ${getErrorMessage(error)}`;
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
