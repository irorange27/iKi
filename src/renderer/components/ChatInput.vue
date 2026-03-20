<template>
  <div class="chat-input-outer">
    <div class="mx-auto max-w-4xl">
      <div class="relative rounded-[22px] border chat-input-container">
        <input
          ref="inputRef"
          v-model="message"
          type="text"
          placeholder="Type a message..."
          class="chat-input-field w-full border-0 bg-transparent px-4 py-6 text-primary placeholder-muted focus:outline-none"
          @keydown.enter="handleEnter"
          @compositionstart="handleCompositionStart"
          @compositionend="handleCompositionEnd"
        />

        <!-- Bottom toolbar -->
        <div
          class="composer-toolbar flex items-center justify-between border-t border-color px-3 py-2"
        >
          <div class="composer-toolbar-left flex items-center gap-2">
            <!-- file upload -->
            <button
              class="composer-attach-btn flex h-8 w-8 items-center justify-center text-secondary"
            >
              <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"
                />
              </svg>
            </button>
            <!-- workspace choose -->
            <button
              class="composer-icon-btn composer-selection-btn relative flex h-10 w-10 items-center justify-center rounded-[14px] text-accent"
            >
              <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
                />
              </svg>
              <span class="selector-badge">1</span>
            </button>
            <!-- skill choose -->
            <SkillSelector v-model:skill-ids="selectedSkillIds" v-model:mode="skillMode" />
            <!-- tool choose -->
            <ToolSelector
              v-model:tools="selectedTools"
              v-model:mcp-server-ids="selectedMcpServerIds"
              v-model:mode="toolMode"
            />
            <div ref="modelSelectorRef" class="relative">
              <button
                class="model-selector-trigger"
                :class="{ 'model-selector-trigger-open': showModelSelector }"
                @click="toggleModelSelector"
              >
                <span class="model-selector-trigger-icon">
                  <LobeIcon
                    v-if="selectedProvider"
                    :name="selectedProviderIconName"
                    :size="16"
                    :fallback-text="selectedProviderFallbackText"
                    class-name="model-selector-provider-icon"
                  />
                  <span v-else class="model-selector-trigger-initials">
                    {{ selectedProviderFallbackText }}
                  </span>
                </span>
                <span class="model-selector-trigger-label">
                  {{ selectedModel || 'Select Model' }}
                </span>
                <svg
                  class="model-selector-trigger-chevron"
                  :class="{ 'rotate-180': showModelSelector }"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M19 9l-7 7-7-7"
                  />
                </svg>
              </button>

              <div v-if="showModelSelector" class="model-selector-panel">
                <div class="model-selector-search-shell">
                  <svg
                    class="model-selector-search-icon"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M21 21l-4.35-4.35m1.85-5.15a7 7 0 11-14 0 7 7 0 0114 0z"
                    />
                  </svg>
                  <input
                    ref="modelSearchInputRef"
                    v-model="modelSearchQuery"
                    type="text"
                    class="model-selector-search-input"
                    placeholder="Search models..."
                  />
                </div>

                <div class="model-selector-scroll">
                  <div
                    v-if="availableProviders.length === 0"
                    class="selector-empty-state model-selector-empty"
                  >
                    No providers configured.
                  </div>
                  <div
                    v-else-if="providerModelGroups.length === 0"
                    class="selector-empty-state model-selector-empty"
                  >
                    No enabled provider exposes model metadata.
                  </div>
                  <div
                    v-else-if="filteredProviderGroups.length === 0"
                    class="selector-empty-state model-selector-empty"
                  >
                    No models match "{{ modelSearchQuery.trim() }}".
                  </div>
                  <section
                    v-for="group in filteredProviderGroups"
                    :key="group.id"
                    class="model-provider-group"
                  >
                    <header class="model-provider-header selector-section-title">
                      <span class="model-provider-icon">
                        <LobeIcon
                          :name="group.iconName"
                          :size="16"
                          :fallback-text="group.fallbackText"
                          class-name="model-selector-provider-icon"
                        />
                      </span>
                      <div class="model-provider-copy">
                        <span class="model-provider-name">{{ group.name }}</span>
                        <span class="model-provider-type">{{ group.typeLabel }}</span>
                      </div>
                    </header>

                    <button
                      v-for="model in group.models"
                      :key="`${group.id}:${model}`"
                      class="model-option"
                      :class="{
                        'model-option-selected': isSelectedProviderModel(group.provider.id, model),
                      }"
                      @click="selectProviderAndModel(group.provider, model)"
                    >
                      <div class="model-option-main">
                        <span
                          class="model-option-check"
                          :class="{
                            'model-option-check-selected': isSelectedProviderModel(
                              group.provider.id,
                              model
                            ),
                          }"
                        >
                          <svg
                            v-if="isSelectedProviderModel(group.provider.id, model)"
                            class="h-3.5 w-3.5"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              stroke-linecap="round"
                              stroke-linejoin="round"
                              stroke-width="2.2"
                              d="M5 13l4 4L19 7"
                            />
                          </svg>
                        </span>
                        <div class="model-option-copy">
                          <span class="model-option-name">{{ model }}</span>
                          <span class="model-option-meta"
                            >{{ group.name }} · {{ group.typeLabel }}</span
                          >
                        </div>
                      </div>
                      <span class="model-option-side">{{ group.typeLabel }}</span>
                    </button>
                  </section>
                </div>
              </div>
            </div>
          </div>

          <div class="composer-toolbar-right flex items-center gap-2">
            <div
              v-if="contextUsage"
              class="composer-context-indicator"
              :title="contextUsage.tooltip"
              aria-label="Context usage"
            >
              <svg
                class="composer-context-icon"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="1.9"
                  d="M5 14a7 7 0 1114 0"
                />
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="1.9"
                  d="M12 14l3-3"
                />
              </svg>
              <span class="composer-context-value">
                {{ contextUsage.percentLabel || contextUsage.tokenLabel }}
              </span>
            </div>
            <button
              class="composer-icon-btn h-8 w-8 rounded-lg text-secondary flex items-center justify-center"
            >
              <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                />
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                />
              </svg>
            </button>

            <div v-if="showWaveform" class="speech-waveform" aria-hidden="true">
              <span
                v-for="(bar, idx) in waveformBars"
                :key="idx"
                class="speech-waveform-bar"
                :style="{ height: `${Math.max(18, Math.round(bar * 100))}%` }"
              />
            </div>

            <button
              class="composer-icon-btn speech-btn h-8 w-8 rounded-lg flex items-center justify-center"
              :class="[
                isRecording
                  ? 'text-danger'
                  : isTranscribing
                    ? 'text-accent'
                    : speechEngineAvailable
                      ? 'text-secondary'
                      : 'text-muted speech-btn-unavailable',
                isTranscribing ? 'is-transcribing' : '',
              ]"
              :disabled="!speechEngineAvailable || isLoading || isStopping || isTranscribing"
              :aria-label="isRecording ? 'Stop voice input' : 'Start voice input'"
              @click="toggleVoiceInput"
            >
              <svg v-if="isRecording" class="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
              <svg
                v-else-if="isTranscribing"
                class="h-4 w-4 animate-spin"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M4 12a8 8 0 018-8m0 16a8 8 0 008-8"
                />
              </svg>
              <svg v-else class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"
                />
              </svg>
            </button>
            <span
              v-if="speechStatusLabel"
              class="text-[10px] whitespace-nowrap"
              :class="speechStatusToneClass"
            >
              {{ speechStatusLabel }}
            </span>
            <button
              class="composer-icon-btn send-btn h-8 w-8 rounded-lg flex items-center justify-center"
              :class="[
                isLoading ? 'text-danger stop-btn' : 'text-accent',
                isStopping ? 'is-stopping' : '',
              ]"
              :aria-label="isLoading ? 'Stop generation' : 'Send message'"
              @click="isLoading ? stopStreaming() : sendMessage()"
              :disabled="isStopping || isRecording || isTranscribing"
            >
              <svg
                v-if="isLoading"
                class="h-4 w-4"
                fill="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
              <svg v-else class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
                />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, nextTick, computed } from 'vue';
import { Chat } from '@ai-sdk/vue';
import type { Provider } from '../../shared/types/provider';
import { parseModelList } from '../../shared/utils/provider_models';
import { toUiMessages } from '../modules/chat/ui_message_convert';
import { getProviderIconName } from '../modules/providers/provider_icons';
import { useSpeechInput } from '../composables/useSpeechInput';
import ToolSelector from './ToolSelector.vue';
import SkillSelector from './SkillSelector.vue';
import LobeIcon from './Icon/LobeIcon.vue';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const window: any;

const props = defineProps<{
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  chat?: Chat<any>;
  threadId?: string;
  contextUsage?: {
    usedTokens: number;
    budgetTokens: number | null;
    percent: number | null;
    percentLabel: string;
    tokenLabel: string;
    tooltip: string;
  } | null;
}>();

const inputRef = ref<HTMLInputElement | null>(null);
const modelSelectorRef = ref<HTMLElement | null>(null);
const modelSearchInputRef = ref<HTMLInputElement | null>(null);
const message = ref('');
const isLoading = ref(false);
const isStopping = ref(false);
const selectedProvider = ref<Provider | null>(null);
const selectedModel = ref('');
const availableProviders = ref<Provider[]>([]);
const isProviderConfigured = ref(false);
const isComposing = ref(false);
const justEndedComposition = ref(false);
const showModelSelector = ref(false);
const modelSearchQuery = ref('');
const selectedTools = ref<string[]>([]);
const selectedMcpServerIds = ref<string[]>([]);
const selectedSkillIds = ref<string[]>([]);
const skillMode = ref<'manual' | 'auto'>('auto');
const toolMode = ref<'manual' | 'auto'>('auto');
const isAutoToolMode = computed(() => toolMode.value === 'auto');
const isAutoSkillMode = computed(() => skillMode.value === 'auto');

type ThreadToolSelectionState = {
  mode?: 'manual' | 'auto';
  mcpServerIds: string[];
};

type ProviderModelGroup = {
  id: string;
  provider: Provider;
  name: string;
  typeLabel: string;
  iconName: string;
  fallbackText: string;
  models: string[];
  providerSearchText: string;
};

const parseStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];

  const resolved: string[] = [];
  const seen = new Set<string>();

  for (const item of value) {
    if (typeof item !== 'string') continue;
    const trimmed = item.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    resolved.push(trimmed);
  }

  return resolved;
};

const getProviderDisplayName = (provider: Pick<Provider, 'name' | 'type'>) =>
  provider.name?.trim() || provider.type?.trim() || 'Provider';

const getProviderFallbackText = (provider?: Pick<Provider, 'name' | 'type'> | null) => {
  const source = provider ? getProviderDisplayName(provider) : 'AI';
  const normalized = source
    .replace(/[^a-zA-Z0-9]/g, '')
    .slice(0, 2)
    .toUpperCase();
  return normalized || 'AI';
};

const providerModelGroups = computed<ProviderModelGroup[]>(() =>
  availableProviders.value
    .map(provider => {
      const name = getProviderDisplayName(provider);
      const typeLabel = provider.type?.trim() || 'custom';

      return {
        id: provider.id,
        provider,
        name,
        typeLabel,
        iconName: getProviderIconName(typeLabel),
        fallbackText: getProviderFallbackText(provider),
        models: parseModelList(provider.models),
        providerSearchText: `${name} ${typeLabel}`.toLowerCase(),
      };
    })
    .filter(group => group.models.length > 0)
);

const filteredProviderGroups = computed<ProviderModelGroup[]>(() => {
  const query = modelSearchQuery.value.trim().toLowerCase();
  if (!query) return providerModelGroups.value;

  return providerModelGroups.value
    .map(group => {
      const matchesProvider = group.providerSearchText.includes(query);
      return {
        ...group,
        models: matchesProvider
          ? group.models
          : group.models.filter(model => model.toLowerCase().includes(query)),
      };
    })
    .filter(group => group.models.length > 0);
});

const selectedProviderIconName = computed(() =>
  selectedProvider.value ? getProviderIconName(selectedProvider.value.type || '') : 'openai'
);

const selectedProviderFallbackText = computed(() =>
  getProviderFallbackText(selectedProvider.value)
);

const parseThreadToolSelectionState = (metadataRaw: unknown): ThreadToolSelectionState => {
  if (!metadataRaw || typeof metadataRaw !== 'object') {
    return { mcpServerIds: [] };
  }

  const metadata = metadataRaw as { toolSelection?: unknown };
  const toolSelection =
    metadata.toolSelection && typeof metadata.toolSelection === 'object'
      ? (metadata.toolSelection as { mode?: unknown; mcpServerIds?: unknown })
      : null;

  return {
    mode:
      toolSelection?.mode === 'auto' || toolSelection?.mode === 'manual'
        ? toolSelection.mode
        : undefined,
    mcpServerIds: parseStringArray(toolSelection?.mcpServerIds),
  };
};

const deriveMcpServerIdsFromToolNames = async (toolNames: string[]): Promise<string[]> => {
  const normalizedToolNames = new Set(parseStringArray(toolNames));
  if (normalizedToolNames.size === 0) return [];

  try {
    const tools = await window.electronAPI.tools.list();
    if (!Array.isArray(tools)) return [];

    const resolvedServerIds = new Set<string>();
    for (const tool of tools) {
      if (!tool || typeof tool !== 'object') continue;
      const name = typeof tool.name === 'string' ? tool.name.trim() : '';
      const source =
        tool.source && typeof tool.source === 'object'
          ? (tool.source as { kind?: unknown; id?: unknown })
          : null;
      if (!name || !normalizedToolNames.has(name)) continue;
      if (source?.kind !== 'mcp' || typeof source.id !== 'string' || !source.id.trim()) continue;
      resolvedServerIds.add(source.id.trim());
    }

    return Array.from(resolvedServerIds);
  } catch (error) {
    console.error('Failed to derive MCP server ids from tools:', error);
    return [];
  }
};

const resolveSelectedMcpServerIds = async (): Promise<string[]> => {
  if (selectedMcpServerIds.value.length > 0) {
    return parseStringArray(selectedMcpServerIds.value);
  }
  return await deriveMcpServerIdsFromToolNames(selectedTools.value);
};

const syncToolSelectionFromThread = async (threadId?: string) => {
  const normalizedThreadId = typeof threadId === 'string' ? threadId.trim() : '';
  if (!normalizedThreadId || isLoading.value) return;

  try {
    const thread = await window.electronAPI.chat.threads.get(normalizedThreadId);
    if (!thread) return;

    const persistedTools = parseStringArray(
      typeof thread.tools === 'string' ? JSON.parse(thread.tools) : []
    );

    let parsedMetadata: unknown = {};
    if (typeof thread.metadata === 'string' && thread.metadata.trim()) {
      try {
        parsedMetadata = JSON.parse(thread.metadata);
      } catch {
        parsedMetadata = {};
      }
    }

    const selectionState = parseThreadToolSelectionState(parsedMetadata);
    const resolvedMcpServerIds =
      selectionState.mcpServerIds.length > 0
        ? selectionState.mcpServerIds
        : await deriveMcpServerIdsFromToolNames(persistedTools);
    const hasPersistedSelection =
      persistedTools.length > 0 ||
      resolvedMcpServerIds.length > 0 ||
      selectionState.mode === 'auto' ||
      selectionState.mode === 'manual';

    if (!hasPersistedSelection) return;

    selectedTools.value = persistedTools;
    selectedMcpServerIds.value = resolvedMcpServerIds;
    if (selectionState.mode) {
      toolMode.value = selectionState.mode;
    }
  } catch (error) {
    console.error('Failed to sync tool selection from thread:', error);
  }
};

const {
  isRecording,
  isTranscribing,
  speechStatusLabel,
  speechStatusToneClass,
  speechEngineAvailable,
  showWaveform,
  waveformBars,
  loadSpeechStatus,
  toggleVoiceInput,
  stopVoiceInput,
} = useSpeechInput({ inputRef, message });

const closeModelSelector = () => {
  showModelSelector.value = false;
  modelSearchQuery.value = '';
};

const toggleModelSelector = async () => {
  showModelSelector.value = !showModelSelector.value;
  if (!showModelSelector.value) {
    modelSearchQuery.value = '';
    return;
  }

  await nextTick();
  modelSearchInputRef.value?.focus();
  modelSearchInputRef.value?.select();
};

const isSelectedProviderModel = (providerId: string, model: string) =>
  selectedProvider.value?.id === providerId && selectedModel.value === model;

const handleDocumentPointerDown = (event: MouseEvent) => {
  if (!showModelSelector.value) return;
  const target = event.target;
  if (!(target instanceof Node)) return;
  if (modelSelectorRef.value?.contains(target)) return;
  closeModelSelector();
};

const handleDocumentKeydown = (event: KeyboardEvent) => {
  if (event.key !== 'Escape' || !showModelSelector.value) return;
  closeModelSelector();
};

const loadAvailableProviders = async () => {
  try {
    const providers = await window.electronAPI.providers.list();
    const normalizedProviders = Array.isArray(providers)
      ? (providers.filter((provider: Provider) => provider?.enabled) as Provider[])
      : [];

    availableProviders.value = normalizedProviders;

    if (normalizedProviders.length === 0) {
      selectedProvider.value = null;
      selectedModel.value = '';
      isProviderConfigured.value = false;
      return;
    }

    const previousProviderId = selectedProvider.value?.id;
    const previousProvider = normalizedProviders.find(
      provider => provider.id === previousProviderId
    );
    const previousProviderModels = previousProvider ? parseModelList(previousProvider.models) : [];
    const nextSelectedProvider =
      (previousProvider && previousProviderModels.length > 0 ? previousProvider : null) ||
      normalizedProviders.find(provider => parseModelList(provider.models).length > 0) ||
      previousProvider ||
      normalizedProviders[0];
    const availableProviderModels = parseModelList(nextSelectedProvider.models);

    selectedProvider.value = nextSelectedProvider;
    if (!availableProviderModels.includes(selectedModel.value)) {
      selectedModel.value = availableProviderModels[0] || '';
    }

    isProviderConfigured.value = true;
  } catch (e) {
    console.error('Failed to load providers:', e);
  }
};

const selectProviderAndModel = (provider: Provider, model: string) => {
  selectedProvider.value = provider;
  selectedModel.value = model;
  closeModelSelector();
  emit('model-selected', { provider, model });
};

watch(selectedProvider, () => {
  checkProviderStatus();
});

watch(
  () => [props.threadId, isLoading.value] as const,
  async ([threadId, loading], [previousThreadId, previousLoading]) => {
    if (loading) return;
    if (threadId === previousThreadId && previousLoading === loading) return;
    await syncToolSelectionFromThread(threadId);
  }
);

// Emit events to parent
const emit = defineEmits(['message-sent', 'model-selected']);

const setDraftMessage = async (
  nextValue: string,
  options?: { focus?: boolean; select?: boolean }
) => {
  message.value = nextValue;
  await nextTick();
  if (options?.focus) {
    inputRef.value?.focus();
  }
  if (options?.select) {
    inputRef.value?.select();
  }
};

defineExpose({
  setDraftMessage,
});

// Check if current provider is configured
const checkProviderStatus = async () => {
  if (!selectedProvider.value) {
    isProviderConfigured.value = false;
    return;
  }
  try {
    isProviderConfigured.value = await window.electronAPI.chat.isProviderConfigured(
      selectedProvider.value.type
    );
  } catch (e) {
    console.error('Failed to check provider status:', e);
    isProviderConfigured.value = false;
  }
};

const stopStreaming = async () => {
  if (!isLoading.value || isStopping.value) return;

  isStopping.value = true;

  try {
    const result = await window.electronAPI.chat.stopStream();
    if (!result?.success) {
      console.warn('Stop stream request failed:', result?.error || 'Unknown error');
      isLoading.value = false;
      isStopping.value = false;
    }
  } catch (error) {
    console.error('Failed to stop stream:', error);
    isLoading.value = false;
    isStopping.value = false;
  }
};

const handleCompositionStart = () => {
  isComposing.value = true;
};

const handleCompositionEnd = () => {
  isComposing.value = false;
  justEndedComposition.value = true;
  window.setTimeout(() => {
    justEndedComposition.value = false;
  }, 0);
};

const handleEnter = (event: KeyboardEvent) => {
  if (
    event.isComposing ||
    event.keyCode === 229 ||
    event.which === 229 ||
    isComposing.value ||
    justEndedComposition.value
  ) {
    return;
  }

  if (isRecording.value || isTranscribing.value) {
    return;
  }

  sendMessage();
};

const sendMessage = async () => {
  if (isRecording.value || isTranscribing.value) {
    stopVoiceInput();
    return;
  }
  if (!message.value.trim() || isLoading.value) return;

  if (!selectedProvider.value) {
    alert('Please configure a provider in Settings first.');
    return;
  }

  // Re-check provider status each time
  const configured = await window.electronAPI.chat.isProviderConfigured(
    selectedProvider.value.type
  );
  const selectedProviderName = getProviderDisplayName(selectedProvider.value);
  if (!configured) {
    alert(`Please configure the ${selectedProviderName} API key in Settings.`);
    return;
  }

  if (!selectedModel.value.trim()) {
    alert(`Please add at least one model for ${selectedProviderName} in Settings.`);
    return;
  }

  const userMessage = message.value.trim();
  const resolvedMcpServerIds = await resolveSelectedMcpServerIds();
  selectedMcpServerIds.value = resolvedMcpServerIds;
  message.value = '';
  isLoading.value = true;
  isStopping.value = false;

  // Emit message-sent and wait for ChatView to finish thread/message setup.
  await new Promise<void>(resolve => {
    let resolved = false;
    const done = () => {
      if (resolved) return;
      resolved = true;
      resolve();
    };

    emit(
      'message-sent',
      userMessage,
      selectedModel.value,
      selectedTools.value,
      resolvedMcpServerIds,
      done
    );
    window.setTimeout(done, 1500);
  });

  try {
    // Convert chat.messages to AI SDK model messages for IPC
    // Note: The user message may not be in chat.messages yet (it's added in ChatView.handleMessageSent)
    // So we need to include it manually if it's not there
    const rawMessages = props.chat?.messages || [];

    // Check if the last message is the user message we just sent
    const lastMessage = rawMessages[rawMessages.length - 1];
    const userMessageInChat =
      lastMessage &&
      lastMessage.role === 'user' &&
      Array.isArray(lastMessage.parts) &&
      lastMessage.parts.find((p: any) => p && p.type === 'text' && p.text === userMessage);

    // If user message is not in chat.messages yet, include it manually
    const messagesToConvert = userMessageInChat
      ? rawMessages
      : [
          ...rawMessages,
          {
            role: 'user',
            parts: [{ type: 'text', text: userMessage }],
          },
        ];

    const uiMessages = toUiMessages(messagesToConvert);

    if (uiMessages.length === 0) {
      console.warn('No valid messages to send');
      isLoading.value = false;
      return;
    }

    const transportMessages = JSON.parse(JSON.stringify(uiMessages));

    // Start streaming via IPC
    const streamResult = await window.electronAPI.chat.stream({
      providerType: selectedProvider.value.type,
      model: selectedModel.value,
      messages: transportMessages,
      tools: isAutoToolMode.value
        ? undefined
        : selectedTools.value.length > 0
          ? JSON.parse(JSON.stringify(selectedTools.value))
          : [],
      mcpServerIds: JSON.parse(JSON.stringify(resolvedMcpServerIds)),
      skillMode: isAutoSkillMode.value ? 'auto' : 'manual',
      skillIds: isAutoSkillMode.value
        ? undefined
        : JSON.parse(JSON.stringify(selectedSkillIds.value)),
      threadId: props.threadId,
    });

    if (streamResult?.success === false) {
      throw new Error(streamResult?.error || 'Stream failed');
    }

    isLoading.value = false;
    isStopping.value = false;
  } catch (error: any) {
    console.error('Failed to send message:', error);
    isLoading.value = false;
    isStopping.value = false;
    // Remove the user message if failed (it was already added to chat.messages in ChatView)
    // The error handler will clean up the state
  }
};

onMounted(async () => {
  document.addEventListener('mousedown', handleDocumentPointerDown);
  document.addEventListener('keydown', handleDocumentKeydown);
  await loadAvailableProviders();
  await loadSpeechStatus();
  await syncToolSelectionFromThread(props.threadId);
});

onUnmounted(() => {
  document.removeEventListener('mousedown', handleDocumentPointerDown);
  document.removeEventListener('keydown', handleDocumentKeydown);
});
</script>
<style scoped>
.chat-input-outer {
  padding: var(--chat-composer-padding, 10px);
}

.chat-input-container {
  border-color: var(--chat-composer-border-color);
  border-radius: 12px;
  background: var(--chat-composer-background);
  box-shadow: var(--chat-composer-shadow);
  backdrop-filter: var(--chat-composer-backdrop-filter);
}

.chat-input-field {
  padding-top: 28px;
  padding-bottom: 28px;
  font-size: 15px;
}

.composer-toolbar {
  padding: 10px 12px 12px;
  border-top-color: var(--chat-composer-toolbar-border-color);
  background: var(--chat-composer-toolbar-background);
}

.composer-toolbar-left {
  gap: 8px;
  min-width: 0;
}

.composer-toolbar-right {
  gap: 14px;
}

.composer-context-indicator {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--text-muted);
  user-select: none;
  white-space: nowrap;
}

.composer-context-icon {
  width: 14px;
  height: 14px;
  opacity: 0.85;
}

.composer-context-value {
  font-size: 13px;
  font-weight: 650;
  letter-spacing: 0.01em;
}

.placeholder-muted::placeholder {
  color: var(--text-muted);
}

.border-color {
  border-color: var(--border-color);
}

button {
  transition: all 0.2s;
}

.composer-attach-btn {
  border: none;
  background: transparent;
  color: var(--text-secondary);
}

.composer-attach-btn:hover {
  color: var(--text-primary);
}

.composer-icon-btn {
  border: 1px solid var(--chat-composer-control-border-color);
  background: var(--chat-composer-control-background);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
}

.composer-selection-btn {
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.04),
    0 8px 18px rgba(0, 0, 0, 0.08);
}

.model-selector-trigger {
  display: inline-flex;
  max-width: min(220px, calc(100vw - 192px));
  height: 40px;
  align-items: center;
  gap: 10px;
  padding: 0 2px 0 6px;
  border: 1px solid transparent;
  background: transparent;
  box-shadow: none;
  color: var(--text-secondary);
}

.model-selector-trigger:hover {
  color: var(--text-primary);
}

.model-selector-trigger-open {
  color: var(--text-primary);
}

.model-selector-trigger-icon {
  display: inline-flex;
  height: 18px;
  width: 18px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  border-radius: 0;
  background: transparent;
  color: currentColor;
}

.model-selector-trigger-initials {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.04em;
}

.model-selector-trigger-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 15px;
  font-weight: 650;
  line-height: 1.2;
}

.model-selector-trigger-chevron {
  height: 16px;
  width: 16px;
  flex-shrink: 0;
  opacity: 0.7;
  transition: transform 0.18s ease;
}

.model-selector-panel {
  position: absolute;
  left: 0;
  bottom: calc(100% + 10px);
  z-index: 60;
  width: min(380px, calc(100vw - 32px));
  overflow: hidden;
  border-radius: 16px;
  border: 1px solid color-mix(in srgb, var(--border-color) 88%, transparent);
  background: color-mix(in srgb, var(--bg-secondary) 94%, transparent);
  box-shadow:
    0 28px 56px rgba(0, 0, 0, 0.34),
    0 12px 22px rgba(0, 0, 0, 0.2);
  backdrop-filter: blur(18px);
}

.model-selector-search-shell {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 16px;
  border-bottom: 1px solid color-mix(in srgb, var(--border-color) 88%, transparent);
  background: color-mix(in srgb, var(--bg-tertiary) 88%, transparent);
}

.model-selector-search-icon {
  height: 18px;
  width: 18px;
  flex-shrink: 0;
  color: var(--text-muted);
}

.model-selector-search-input {
  width: 100%;
  border: 0;
  background: transparent;
  color: var(--text-primary);
  font-size: 14px;
  line-height: 1.4;
  outline: none;
}

.model-selector-search-input::placeholder {
  color: var(--text-muted);
}

.model-selector-scroll {
  max-height: 26rem;
  overflow-y: auto;
  padding: 8px;
}

.model-selector-empty {
  padding-top: 28px;
  padding-bottom: 28px;
}

.model-provider-group {
  padding: 4px 0 10px;
}

.model-provider-group + .model-provider-group {
  margin-top: 4px;
  border-top: 1px solid color-mix(in srgb, var(--border-color) 70%, transparent);
  padding-top: 14px;
}

.model-provider-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px 6px;
}

.model-provider-icon {
  display: inline-flex;
  height: 16px;
  width: 16px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  border-radius: 6px;
  background: transparent;
  color: var(--text-muted);
}

.model-provider-copy,
.model-option-copy {
  display: flex;
  min-width: 0;
  flex-direction: column;
}

.model-provider-copy {
  flex-direction: row;
  align-items: center;
  gap: 6px;
}

.model-provider-name {
  color: inherit;
}

.model-provider-type {
  font-size: inherit;
  font-weight: inherit;
  line-height: inherit;
  letter-spacing: 0.04em;
  text-transform: none;
  color: color-mix(in srgb, var(--text-muted) 92%, var(--text-primary));
}

.model-option {
  display: flex;
  width: 100%;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 4px;
  padding: 12px 14px;
  border: 1px solid transparent;
  border-radius: 14px;
  background: transparent;
  color: var(--text-primary);
  text-align: left;
  transition:
    background-color 0.18s ease,
    border-color 0.18s ease,
    transform 0.18s ease;
}

.model-option:hover:not(:disabled) {
  background: color-mix(in srgb, var(--bg-hover) 88%, transparent);
  border-color: color-mix(in srgb, var(--border-color) 78%, transparent);
}

.model-option-selected {
  background: rgba(var(--accent-rgb, 74, 158, 255), 0.22);
  border-color: rgba(var(--accent-rgb, 74, 158, 255), 0.34);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.05);
}

.model-option-main {
  display: flex;
  min-width: 0;
  flex: 1 1 auto;
  align-items: flex-start;
  gap: 12px;
}

.model-option-check {
  display: inline-flex;
  height: 22px;
  width: 22px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  margin-top: 1px;
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--border-color) 88%, transparent);
  background: rgba(255, 255, 255, 0.02);
  color: transparent;
  transition:
    background-color 0.18s ease,
    border-color 0.18s ease,
    color 0.18s ease;
}

.model-option-check-selected {
  border-color: rgba(var(--accent-rgb, 74, 158, 255), 0.44);
  background: rgba(var(--accent-rgb, 74, 158, 255), 0.88);
  color: var(--accent-contrast);
}

.model-option-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 14px;
  font-weight: 700;
  line-height: 1.3;
  color: inherit;
}

.model-option-meta {
  margin-top: 3px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  line-height: 1.35;
  color: var(--text-muted);
}

.model-option-side {
  max-width: 88px;
  flex-shrink: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  font-weight: 600;
  line-height: 1.2;
  color: color-mix(in srgb, var(--text-muted) 88%, var(--text-primary));
}

.model-selector-trigger-icon :deep(.lobe-icon),
.model-selector-trigger-icon :deep(.lobe-icon-placeholder),
.model-provider-icon :deep(.lobe-icon),
.model-provider-icon :deep(.lobe-icon-placeholder) {
  height: 16px;
  width: 16px;
}

.model-selector-trigger-icon :deep(.lobe-icon-placeholder),
.model-provider-icon :deep(.lobe-icon-placeholder) {
  border-radius: 6px;
  background: transparent;
  font-size: 9px;
  font-weight: 700;
  color: inherit;
}

.send-btn {
  background: var(--chat-composer-send-background);
  box-shadow: none;
}

.stop-btn {
  background-color: var(--chat-composer-stop-background);
}

.stop-btn:hover:not(:disabled) {
  background-color: var(--chat-composer-stop-hover-background);
  border-color: var(--chat-composer-stop-hover-border-color);
  color: var(--chat-composer-action-foreground);
}

.send-btn:hover:not(:disabled) {
  background: var(--chat-composer-send-hover-background);
  border-color: var(--chat-composer-send-hover-border-color);
  box-shadow: var(--chat-composer-send-hover-shadow);
  color: var(--chat-composer-action-foreground);
}

.is-stopping {
  opacity: 0.75;
}

.is-transcribing {
  animation: micPulse 1.2s ease-in-out infinite;
}

.composer-icon-btn:hover {
  background-color: var(--chat-composer-control-hover-background);
  border-color: var(--chat-composer-control-hover-border-color);
  color: var(--text-primary);
}

.composer-icon-btn:disabled {
  opacity: 0.78;
  border-color: var(--chat-composer-control-disabled-border-color);
  background: var(--chat-composer-control-disabled-background);
}

.speech-btn-unavailable {
  color: color-mix(in srgb, var(--text-secondary) 68%, var(--text-muted));
}

.speech-btn-unavailable:disabled {
  opacity: 0.9;
}

.speech-waveform {
  display: inline-flex;
  align-items: flex-end;
  justify-content: center;
  gap: 2px;
  height: 32px;
  width: 32px;
  padding: 6px 5px;
  border-radius: 10px;
  border: 1px solid rgba(var(--accent-rgb, 74, 158, 255), 0.35);
  background: rgba(var(--accent-rgb, 74, 158, 255), 0.18);
  color: var(--accent-color);
  box-shadow: inset 0 0 0 1px rgba(var(--accent-rgb, 74, 158, 255), 0.08);
}

.speech-waveform-bar {
  width: 3px;
  min-height: 6px;
  border-radius: 999px;
  background-color: currentColor;
  transition: height 0.08s ease;
}

.rotate-180 {
  transform: rotate(180deg);
}

@keyframes micPulse {
  0%,
  100% {
    opacity: 0.6;
  }
  50% {
    opacity: 1;
  }
}

button:disabled {
  cursor: not-allowed;
}
</style>
