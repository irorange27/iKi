<template>
  <div class="chat-input-outer">
    <div class="mx-auto max-w-3xl">
      <div class="relative rounded-xl border chat-input-container">
        <input ref="inputRef" v-model="message" type="text" placeholder="Type a message..."
          class="w-full border-0 bg-transparent px-4 py-6 text-primary placeholder-muted focus:outline-none"
          @keydown.enter="handleEnter"
          @compositionstart="handleCompositionStart"
          @compositionend="handleCompositionEnd" />

        <!-- Bottom toolbar -->
        <div class="flex items-center justify-between border-t border-color px-3 py-2">
          <div class="flex items-center gap-2">
            <!-- file upload -->
            <button class="h-8 w-8 rounded-lg text-secondary flex items-center justify-center icon-btn">
              <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                  d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
              </svg>
            </button>
            <!-- workspace choose -->
            <button class="relative h-8 w-8 rounded-lg text-accent flex items-center justify-center icon-btn">
              <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                  d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
              </svg>
              <span
                class="absolute right-0 top-0 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-[#4a9eff] text-[9px] text-white">
                1
              </span>
            </button>
            <!-- skill choose -->
            <div
              class="relative"
              @mouseenter="openSkillSelector"
              @mouseleave="scheduleCloseSkillSelector"
            >
              <button
                class="relative h-8 w-8 rounded-lg text-secondary flex items-center justify-center icon-btn"
                :class="{ 'text-accent': isAutoSkillMode || selectedSkillIds.length > 0 }"
                @click="showSkillSelector = !showSkillSelector"
                @mouseenter="openSkillSelector"
                @mouseleave="scheduleCloseSkillSelector"
              >
                <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.746 0 3.332.477 4.5 1.253v13C19.832 18.477 18.246 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
                  />
                </svg>
                <span
                  v-if="isAutoSkillMode || selectedSkillIds.length > 0"
                  class="absolute right-0 top-0 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-[#4a9eff] text-[9px] text-white"
                >
                  {{ isAutoSkillMode ? 'A' : selectedSkillIds.length }}
                </span>
              </button>

              <!-- Skill Selector Menu -->
              <div
                v-if="showSkillSelector"
                class="absolute bottom-full left-0 mb-2 w-80 rounded-xl border border-color bg-secondary shadow-xl z-50 overflow-hidden"
                @mouseenter="openSkillSelector"
                @mouseleave="scheduleCloseSkillSelector"
              >
                <div class="p-3 border-b border-color bg-tertiary">
                  <div class="flex items-center justify-between">
                    <span class="text-sm font-semibold text-primary">Skills</span>
                  </div>
                  <div class="mt-1 text-xs text-muted leading-snug">
                    Inject reusable instructions (workflows, best practices) into the next
                    response. Skills are loaded from your local filesystem.
                  </div>

                  <div class="mt-2 flex items-center gap-2">
                    <button
                      class="tool-mode-btn"
                      :class="{ active: isAutoSkillMode }"
                      @click="toggleAutoSkillMode"
                    >
                      Auto
                    </button>
                    <div class="flex-1" />
                    <button
                      class="tool-action-btn"
                      :disabled="isAutoSkillMode"
                      @click="selectAllSkills"
                    >
                      Select all
                    </button>
                    <button
                      class="tool-action-btn"
                      :disabled="isAutoSkillMode"
                      @click="clearAllSkills"
                    >
                      Clear
                    </button>
                  </div>
                  <div v-if="isAutoSkillMode" class="mt-2 text-xs text-accent leading-snug">
                    iKi will automatically pick relevant skills based on your message.
                  </div>
                </div>
                <div class="max-h-72 overflow-y-auto p-2">
                  <div
                    v-if="availableSkills.length === 0"
                    class="p-4 text-center text-sm text-muted"
                  >
                    No skills found.
                  </div>
                  <button
                    v-for="skill in availableSkills"
                    :key="skill.id"
                    class="w-full text-left px-3 py-2 text-sm rounded-lg hover:bg-hover flex items-center justify-between group"
                    :disabled="isAutoSkillMode"
                    :class="{
                      'text-accent bg-hover/50': isSkillSelected(skill.id) && !isAutoSkillMode,
                      'opacity-60 cursor-not-allowed': isAutoSkillMode,
                    }"
                    @click="toggleSkill(skill.id)"
                  >
                    <div class="flex flex-col">
                      <span class="font-medium">{{ skill.name }}</span>
                      <span class="text-[10px] text-muted truncate max-w-[180px]">
                        {{ skill.description || skill.path || skill.id }}
                      </span>
                    </div>
                    <div
                      class="flex h-4 w-4 items-center justify-center rounded border border-color"
                      :class="{ 'bg-accent border-accent': isSkillSelected(skill.id) }"
                    >
                      <svg
                        v-if="isSkillSelected(skill.id)"
                        class="h-3 w-3 text-white"
                        viewBox="0 0 20 20"
                        fill="currentColor"
                      >
                        <path
                          fill-rule="evenodd"
                          d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                          clip-rule="evenodd"
                        />
                      </svg>
                    </div>
                  </button>
                </div>
              </div>
            </div>
            <!-- tool choose -->
            <div
              class="relative"
              @mouseenter="openToolSelector"
              @mouseleave="scheduleCloseToolSelector"
            >
              <button class="relative h-8 w-8 rounded-lg text-secondary flex items-center justify-center icon-btn"
                :class="{ 'text-accent': isAutoToolMode || selectedTools.length > 0 }"
                @click="showToolSelector = !showToolSelector"
                @mouseenter="openToolSelector"
                @mouseleave="scheduleCloseToolSelector">
                <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                    d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
                </svg>
                <span v-if="isAutoToolMode || selectedTools.length > 0"
                  class="absolute right-0 top-0 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-[#4a9eff] text-[9px] text-white">
                  {{ isAutoToolMode ? 'A' : selectedTools.length }}
                </span>
              </button>

              <!-- Tool Selector Menu -->
              <div v-if="showToolSelector"
                class="absolute bottom-full left-0 mb-2 w-80 rounded-xl border border-color bg-secondary shadow-xl z-50 overflow-hidden"
                @mouseenter="openToolSelector"
                @mouseleave="scheduleCloseToolSelector">
                <div class="p-3 border-b border-color bg-tertiary">
                  <div class="flex items-center justify-between">
                    <span class="text-sm font-semibold text-primary">Tools</span>
                  </div>
                  <div class="mt-1 text-xs text-muted leading-snug">
                    Allow iKi to use tools (web, files, shell) for the next response. Choose Auto
                    or select manually.
                  </div>

                  <div class="mt-2 flex items-center gap-2">
                    <button
                      class="tool-mode-btn"
                      :class="{ active: isAutoToolMode }"
                      @click="toggleAutoToolMode"
                    >
                      Auto
                    </button>
                    <div class="flex-1" />
                    <button
                      class="tool-action-btn"
                      :disabled="isAutoToolMode"
                      @click="selectAllTools"
                    >
                      Select all
                    </button>
                    <button
                      class="tool-action-btn"
                      :disabled="isAutoToolMode"
                      @click="clearAllTools"
                    >
                      Clear
                    </button>
                  </div>

                  <div v-if="isAutoToolMode" class="mt-2 text-xs text-accent leading-snug">
                    Auto enables the default toolset. iKi will decide if and when to call tools.
                  </div>
                </div>
                <div class="max-h-72 overflow-y-auto p-2">
                  <div v-if="availableTools.length === 0" class="p-4 text-center text-sm text-muted">
                    No tools available.
                  </div>
                  <button v-for="tool in availableTools" :key="tool.name"
                    class="w-full text-left px-3 py-2 text-sm rounded-lg hover:bg-hover flex items-center justify-between group"
                    :disabled="isAutoToolMode"
                    :class="{
                      'text-accent bg-hover/50': isToolSelected(tool.name) && !isAutoToolMode,
                      'opacity-60 cursor-not-allowed': isAutoToolMode,
                    }" @click="toggleTool(tool.name)">
                    <div class="flex flex-col">
                      <span class="font-medium">{{ tool.name }}</span>
                      <span class="text-[10px] text-muted truncate max-w-[180px]">{{
                        tool.description
                        }}</span>
                    </div>
                    <div class="flex h-4 w-4 items-center justify-center rounded border border-color"
                      :class="{ 'bg-accent border-accent': isToolSelected(tool.name) && !isAutoToolMode }">
                      <svg v-if="isToolSelected(tool.name) && !isAutoToolMode" class="h-3 w-3 text-white" viewBox="0 0 20 20"
                        fill="currentColor">
                        <path fill-rule="evenodd"
                          d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                          clip-rule="evenodd" />
                      </svg>
                    </div>
                  </button>
                </div>
              </div>
            </div>
            <div class="relative">
              <button class="flex items-center gap-1 rounded-lg px-2 py-1 text-sm text-secondary icon-btn"
                @click="showModelSelector = !showModelSelector">
                <svg class="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                  <path
                    d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
                </svg>
                <span>{{ selectedModel || 'Select Model' }}</span>
                <svg class="h-3 w-3 transition-transform" :class="{ 'rotate-180': showModelSelector }" fill="none"
                  stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              <!-- Model/Provider Selector Menu -->
              <div v-if="showModelSelector"
                class="absolute bottom-full left-0 mb-2 w-64 rounded-xl border border-color bg-secondary shadow-xl z-50 overflow-hidden">
                <div class="p-2 border-b border-color bg-tertiary">
                  <span class="text-xs font-semibold text-muted uppercase tracking-wider">Select AI Model</span>
                </div>
                <div class="max-h-64 overflow-y-auto p-1">
                  <div v-if="availableProviders.length === 0" class="p-4 text-center text-sm text-muted">
                    No providers configured.
                  </div>
                  <div v-for="provider in availableProviders" :key="provider.id" class="mb-1">
                    <div class="px-3 py-1 text-[10px] font-bold text-accent uppercase">
                      {{ provider.name }}
                    </div>
                    <button v-for="model in parseModelList(provider.models)" :key="model"
                      class="w-full text-left px-3 py-2 text-sm rounded-lg hover:bg-hover flex items-center justify-between"
                      :class="{
                        'text-accent bg-hover/50':
                          selectedModel === model && selectedProvider.id === provider.id,
                      }" @click="selectProviderAndModel(provider, model)">
                      <span>{{ model }}</span>
                      <svg v-if="selectedModel === model && selectedProvider.id === provider.id"
                        class="h-4 w-4 text-accent" viewBox="0 0 20 20" fill="currentColor">
                        <path fill-rule="evenodd"
                          d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                          clip-rule="evenodd" />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div class="flex items-center gap-2">
            <button class="h-8 w-8 rounded-lg text-secondary flex items-center justify-center icon-btn">
              <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                  d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                  d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
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
              class="h-8 w-8 rounded-lg flex items-center justify-center icon-btn"
              :class="[
                isRecording
                  ? 'text-danger'
                  : isTranscribing
                    ? 'text-accent'
                    : speechEngineAvailable
                      ? 'text-secondary'
                      : 'text-muted',
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
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                  d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
              </svg>
            </button>
            <span
              v-if="speechStatusLabel"
              class="text-[10px] whitespace-nowrap"
              :class="speechStatusToneClass"
            >
              {{ speechStatusLabel }}
            </span>
            <button class="h-8 w-8 rounded-lg flex items-center justify-center icon-btn" :class="[
              isLoading ? 'text-danger stop-btn' : 'text-accent',
              isStopping ? 'is-stopping' : '',
            ]" :aria-label="isLoading ? 'Stop generation' : 'Send message'" @click="isLoading ? stopStreaming() : sendMessage()"
              :disabled="isStopping || isRecording || isTranscribing">
              <svg v-if="isLoading" class="h-4 w-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
              <svg v-else class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                  d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch, nextTick, computed, onUnmounted } from 'vue';
import { Chat } from '@ai-sdk/vue';
import type { UIMessage } from 'ai';
import type { SpeechStatus } from '../../shared/types/speech';
import { parseModelList } from '../../shared/utils/provider_models';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const window: any;

const props = defineProps<{
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  chat?: Chat<any>;
  threadId?: string;
}>();

const inputRef = ref<HTMLInputElement | null>(null);
const message = ref('');
const isLoading = ref(false);
const isStopping = ref(false);
const streamDebugRequestId = ref('');
const selectedProvider = ref<any>(null);
const selectedModel = ref('');
const availableProviders = ref<any[]>([]);
const availableModels = ref<string[]>([]);
const isProviderConfigured = ref(false);
const isComposing = ref(false);
const justEndedComposition = ref(false);
const showModelSelector = ref(false);
const showToolSelector = ref(false);
const showSkillSelector = ref(false);
const availableTools = ref<any[]>([]);
const availableSkills = ref<any[]>([]);
const selectedTools = ref<string[]>([]);
const selectedSkillIds = ref<string[]>([]);
const skillMode = ref<'manual' | 'auto'>('auto');
const toolMode = ref<'manual' | 'auto'>('manual');
const isAutoToolMode = computed(() => toolMode.value === 'auto');
const isAutoSkillMode = computed(() => skillMode.value === 'auto');
const toolSelectorCloseTimer = ref<number | null>(null);
const skillSelectorCloseTimer = ref<number | null>(null);
const speechStatus = ref<SpeechStatus | null>(null);
const isRecording = ref(false);
const isTranscribing = ref(false);
const speechError = ref('');
const speechErrorTimer = ref<number | null>(null);
const speechDraftBase = ref('');
const mediaRecorder = ref<MediaRecorder | null>(null);
const mediaStream = ref<MediaStream | null>(null);
const recordingTimeout = ref<number | null>(null);
const WAVEFORM_BAR_COUNT = 5;
const waveformBars = ref<number[]>(Array.from({ length: WAVEFORM_BAR_COUNT }, () => 0.2));
const showWaveform = computed(() => isRecording.value && Boolean(mediaStream.value));
const isNodeSpeechAvailable = computed(() => Boolean(speechStatus.value?.available));
const isSpeechEnabled = computed(() => speechStatus.value?.enabled === true);
const requestedSpeechProvider = computed(() => speechStatus.value?.providerType);
const canRecordAudio = computed(
  () => Boolean(navigator?.mediaDevices?.getUserMedia) && typeof MediaRecorder !== 'undefined'
);
const speechEngine = computed<'node' | 'none'>(() => {
  if (!isSpeechEnabled.value) return 'none';
  if (requestedSpeechProvider.value) {
    return isNodeSpeechAvailable.value && canRecordAudio.value ? 'node' : 'none';
  }
  return isNodeSpeechAvailable.value && canRecordAudio.value ? 'node' : 'none';
});
const speechEngineAvailable = computed(() => speechEngine.value !== 'none');
const speechStatusLabel = computed(() => speechError.value);
const speechStatusToneClass = computed(() => (speechError.value ? 'text-danger' : 'text-muted'));

const toUiMessages = (messages: any[]): UIMessage[] =>
  messages
    .filter(
      (message: any) =>
        message &&
        typeof message === 'object' &&
        (message.role === 'system' || message.role === 'user' || message.role === 'assistant')
    )
    .map((message: any) => {
      const parts = Array.isArray(message.parts)
        ? message.parts.filter((part: any) => part && typeof part === 'object' && typeof part.type === 'string')
        : [
          {
            type: 'text',
            text: typeof message.content === 'string' ? message.content : '',
          },
        ];

      return {
        id:
          typeof message.id === 'string' && message.id.length > 0
            ? message.id
            : `ui_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        role: message.role,
        parts,
      } as UIMessage;
    });

const loadAvailableProviders = async () => {
  try {
    const providers = await window.electronAPI.providers.list();
    availableProviders.value = providers.filter((p: any) => p.enabled);

    if (availableProviders.value.length > 0) {
      // Set default provider if none selected
      if (!selectedProvider.value) {
        selectedProvider.value = availableProviders.value[0];
        const models = parseModelList(selectedProvider.value.models);
        availableModels.value = models;
        selectedModel.value = models[0] || '';
      }
      isProviderConfigured.value = true;
    } else {
      isProviderConfigured.value = false;
    }
  } catch (e) {
    console.error('Failed to load providers:', e);
  }
};

const selectProviderAndModel = (provider: any, model: string) => {
  selectedProvider.value = provider;
  availableModels.value = parseModelList(provider.models);
  selectedModel.value = model;
  showModelSelector.value = false;
  emit('model-selected', { provider, model });
};

const loadAvailableTools = async () => {
  try {
    const tools = await window.electronAPI.tools.list();
    availableTools.value = tools;
    // Default: enable all tools so the agent can decide whether to call them.
    // Only apply if the user hasn't made a selection yet.
    if (selectedTools.value.length === 0 && Array.isArray(tools) && tools.length > 0) {
      selectedTools.value = tools
        .map((tool: any) => (tool && typeof tool.name === 'string' ? tool.name : ''))
        .filter((name: string) => typeof name === 'string' && name.trim().length > 0);
    }
  } catch (e) {
    console.error('Failed to load tools:', e);
  }
};

const loadAvailableSkills = async () => {
  try {
    const skills = await window.electronAPI.skills.list();
    availableSkills.value = Array.isArray(skills) ? skills : [];
  } catch (e) {
    console.error('Failed to load skills:', e);
    availableSkills.value = [];
  }
};

const toggleAutoSkillMode = () => {
  skillMode.value = isAutoSkillMode.value ? 'manual' : 'auto';
};

const toggleSkill = (skillId: string) => {
  if (isAutoSkillMode.value) return;
  const index = selectedSkillIds.value.indexOf(skillId);
  if (index === -1) {
    selectedSkillIds.value.push(skillId);
  } else {
    selectedSkillIds.value.splice(index, 1);
  }
};

const isSkillSelected = (skillId: string) => {
  return selectedSkillIds.value.includes(skillId);
};

const selectAllSkills = () => {
  if (isAutoSkillMode.value) return;
  selectedSkillIds.value = availableSkills.value
    .map((skill: any) => (skill && typeof skill.id === 'string' ? skill.id : ''))
    .filter((id: string) => typeof id === 'string' && id.trim().length > 0);
};

const clearAllSkills = () => {
  if (isAutoSkillMode.value) return;
  selectedSkillIds.value = [];
};

const openSkillSelector = () => {
  if (skillSelectorCloseTimer.value !== null) {
    window.clearTimeout(skillSelectorCloseTimer.value);
    skillSelectorCloseTimer.value = null;
  }
  showSkillSelector.value = true;
};

const scheduleCloseSkillSelector = () => {
  if (skillSelectorCloseTimer.value !== null) {
    window.clearTimeout(skillSelectorCloseTimer.value);
  }
  skillSelectorCloseTimer.value = window.setTimeout(() => {
    showSkillSelector.value = false;
    skillSelectorCloseTimer.value = null;
  }, 180);
};

const toggleTool = (toolName: string) => {
  if (isAutoToolMode.value) return;
  const index = selectedTools.value.indexOf(toolName);
  if (index === -1) {
    selectedTools.value.push(toolName);
  } else {
    selectedTools.value.splice(index, 1);
  }
};

const isToolSelected = (toolName: string) => {
  return selectedTools.value.includes(toolName);
};

const selectAllTools = () => {
  if (isAutoToolMode.value) return;
  selectedTools.value = availableTools.value
    .map((t: any) => (t && typeof t.name === 'string' ? t.name : ''))
    .filter((name: string) => typeof name === 'string' && name.trim().length > 0);
};

const clearAllTools = () => {
  if (isAutoToolMode.value) return;
  selectedTools.value = [];
};

const toggleAutoToolMode = () => {
  toolMode.value = isAutoToolMode.value ? 'manual' : 'auto';
};

const openToolSelector = () => {
  if (toolSelectorCloseTimer.value !== null) {
    window.clearTimeout(toolSelectorCloseTimer.value);
    toolSelectorCloseTimer.value = null;
  }
  showToolSelector.value = true;
};

const scheduleCloseToolSelector = () => {
  if (toolSelectorCloseTimer.value !== null) {
    window.clearTimeout(toolSelectorCloseTimer.value);
  }
  toolSelectorCloseTimer.value = window.setTimeout(() => {
    showToolSelector.value = false;
    toolSelectorCloseTimer.value = null;
  }, 180);
};

const loadSpeechStatus = async () => {
  if (!window?.electronAPI?.speech?.getStatus) {
    speechStatus.value = { available: false, reason: 'Speech service unavailable' };
    return;
  }
  try {
    speechStatus.value = await window.electronAPI.speech.getStatus();
  } catch (error) {
    console.error('Failed to load speech status:', error);
    speechStatus.value = { available: false, reason: 'Speech service unavailable' };
  }
};

const clearSpeechError = () => {
  speechError.value = '';
  if (speechErrorTimer.value !== null) {
    window.clearTimeout(speechErrorTimer.value);
    speechErrorTimer.value = null;
  }
};

const setSpeechError = (message: string) => {
  speechError.value = message;
  if (speechErrorTimer.value !== null) {
    window.clearTimeout(speechErrorTimer.value);
  }
  speechErrorTimer.value = window.setTimeout(() => {
    clearSpeechError();
  }, 4000);
};

const applySpeechText = async (text: string) => {
  const trimmed = text.trim();
  if (!trimmed) return;
  const input = inputRef.value;
  if (!input) {
    message.value = `${speechDraftBase.value} ${trimmed}`.trim();
    return;
  }
  const current = message.value || '';
  const start = typeof input.selectionStart === 'number' ? input.selectionStart : current.length;
  const end = typeof input.selectionEnd === 'number' ? input.selectionEnd : current.length;
  const prefix = current.slice(0, start);
  const suffix = current.slice(end);
  let insert = trimmed;
  if (prefix && !/\s$/.test(prefix)) {
    insert = ` ${insert}`;
  }
  if (suffix && !/^\s/.test(suffix)) {
    insert = `${insert} `;
  }
  message.value = `${prefix}${insert}${suffix}`.trim();
  await nextTick();
  const cursor = (prefix + insert).length;
  input.setSelectionRange(cursor, cursor);
  input.focus();
};

const resetSpeechDraft = () => {
  speechDraftBase.value = message.value;
};

const getTranscriptionLanguage = () => {
  const locale = navigator?.language || 'en';
  return locale.split('-')[0];
};

const pickRecordingMimeType = () => {
  if (typeof MediaRecorder === 'undefined') return '';
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/ogg',
  ];
  return candidates.find(type => MediaRecorder.isTypeSupported(type)) || '';
};

let waveformAudioContext: AudioContext | null = null;
let waveformAnalyser: AnalyserNode | null = null;
let waveformSource: MediaStreamAudioSourceNode | null = null;
let waveformRafId: number | null = null;

const resetWaveformBars = () => {
  waveformBars.value = Array.from({ length: WAVEFORM_BAR_COUNT }, () => 0.2);
};

const updateWaveform = () => {
  if (!waveformAnalyser) return;
  const data = new Uint8Array(waveformAnalyser.frequencyBinCount);
  waveformAnalyser.getByteFrequencyData(data);
  const step = Math.max(1, Math.floor(data.length / WAVEFORM_BAR_COUNT));
  const nextBars = new Array(WAVEFORM_BAR_COUNT).fill(0).map((_, index) => {
    const start = index * step;
    let sum = 0;
    for (let i = 0; i < step; i += 1) {
      sum += data[start + i] || 0;
    }
    const avg = sum / step / 255;
    return Math.min(1, Math.pow(avg * 1.4, 0.8));
  });
  waveformBars.value = nextBars;
  waveformRafId = window.requestAnimationFrame(updateWaveform);
};

const startWaveform = (stream?: MediaStream | null) => {
  stopWaveform();
  resetWaveformBars();
  const AudioContextCtor = window?.AudioContext || window?.webkitAudioContext;
  if (!stream || !AudioContextCtor) return;
  try {
    waveformAudioContext = new AudioContextCtor();
    waveformAnalyser = waveformAudioContext.createAnalyser();
    waveformAnalyser.fftSize = 256;
    waveformAnalyser.smoothingTimeConstant = 0.75;
    waveformSource = waveformAudioContext.createMediaStreamSource(stream);
    waveformSource.connect(waveformAnalyser);
    if (typeof waveformAudioContext.resume === 'function') {
      waveformAudioContext.resume().catch(() => {});
    }
    waveformRafId = window.requestAnimationFrame(updateWaveform);
  } catch (error) {
    console.warn('Failed to start audio waveform:', error);
  }
};

const stopWaveform = () => {
  if (waveformRafId !== null) {
    window.cancelAnimationFrame(waveformRafId);
    waveformRafId = null;
  }
  if (waveformSource) {
    try {
      waveformSource.disconnect();
    } catch {
      // Ignore disconnect errors
    }
    waveformSource = null;
  }
  if (waveformAnalyser) {
    try {
      waveformAnalyser.disconnect();
    } catch {
      // Ignore disconnect errors
    }
    waveformAnalyser = null;
  }
  if (waveformAudioContext) {
    const context = waveformAudioContext;
    waveformAudioContext = null;
    if (typeof context.close === 'function') {
      context.close().catch(() => {});
    }
  }
  resetWaveformBars();
};

const clearRecordingTimeout = () => {
  if (recordingTimeout.value !== null) {
    window.clearTimeout(recordingTimeout.value);
    recordingTimeout.value = null;
  }
};

const stopMediaTracks = () => {
  stopWaveform();
  if (mediaStream.value) {
    mediaStream.value.getTracks().forEach(track => track.stop());
    mediaStream.value = null;
  }
  mediaRecorder.value = null;
};

const blobToBase64 = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        reject(new Error('Failed to read audio data'));
        return;
      }
      const base64 = reader.result.split(',')[1];
      resolve(base64 || '');
    };
    reader.onerror = () => {
      reject(reader.error || new Error('Failed to read audio data'));
    };
    reader.readAsDataURL(blob);
  });

const transcribeRecording = async (blob: Blob) => {
  if (!blob || blob.size === 0) return;
  if (!window?.electronAPI?.speech?.transcribe) {
    setSpeechError('Speech service unavailable');
    return;
  }
  isTranscribing.value = true;
  try {
    const audioBase64 = await blobToBase64(blob);
    const providerType = speechStatus.value?.providerType;
    const languageHint =
      providerType === 'openai'
        ? speechStatus.value?.language || getTranscriptionLanguage()
        : speechStatus.value?.language;
    const result = await window.electronAPI.speech.transcribe({
      audioBase64,
      mimeType: blob.type || 'audio/webm',
      language: languageHint,
      prompt: providerType === 'openai' ? speechStatus.value?.prompt : undefined,
      model: speechStatus.value?.model,
    });
    const text = typeof result?.text === 'string' ? result.text : '';
    if (text.trim()) {
      await applySpeechText(text);
    } else {
      setSpeechError('No speech detected');
    }
  } catch (error) {
    console.error('Speech transcription failed:', error);
    setSpeechError('Transcription failed');
  } finally {
    isTranscribing.value = false;
  }
};

const startNodeRecording = async () => {
  if (!canRecordAudio.value) {
    setSpeechError('Microphone not available');
    return;
  }
  clearSpeechError();
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaStream.value = stream;
    startWaveform(stream);

    const mimeType = pickRecordingMimeType();
    const recorder = mimeType
      ? new MediaRecorder(stream, { mimeType })
      : new MediaRecorder(stream);

    const chunks: BlobPart[] = [];
    recorder.ondataavailable = event => {
      if (event.data && event.data.size > 0) {
        chunks.push(event.data);
      }
    };
    recorder.onerror = event => {
      console.error('Recording error:', event);
      setSpeechError('Recording failed');
      isRecording.value = false;
      stopMediaTracks();
    };
    recorder.onstop = async () => {
      clearRecordingTimeout();
      isRecording.value = false;
      const blob = new Blob(chunks, { type: recorder.mimeType || mimeType || 'audio/webm' });
      stopMediaTracks();
      await transcribeRecording(blob);
    };

    mediaRecorder.value = recorder;
    resetSpeechDraft();
    recorder.start();
    isRecording.value = true;

    clearRecordingTimeout();
    recordingTimeout.value = window.setTimeout(() => {
      if (isRecording.value) {
        stopNodeRecording();
      }
    }, 60000);
  } catch (error) {
    console.error('Failed to start recording:', error);
    setSpeechError('Microphone permission denied');
    stopMediaTracks();
  }
};

const stopNodeRecording = () => {
  clearRecordingTimeout();
  if (mediaRecorder.value && mediaRecorder.value.state !== 'inactive') {
    mediaRecorder.value.stop();
    return;
  }
  isRecording.value = false;
  stopMediaTracks();
};

const stopVoiceInput = () => {
  if (mediaRecorder.value || isRecording.value) {
    stopNodeRecording();
  }
};

const toggleVoiceInput = async () => {
  if (isTranscribing.value) return;
  if (isRecording.value) {
    stopVoiceInput();
    return;
  }
  if (!speechEngineAvailable.value) {
    await loadSpeechStatus();
    if (!speechEngineAvailable.value) {
      setSpeechError(speechStatus.value?.reason || 'Voice input unavailable');
      return;
    }
  }
  if (speechEngine.value !== 'node') {
    setSpeechError(speechStatus.value?.reason || 'Voice input unavailable');
    return;
  }
  await startNodeRecording();
};

watch(selectedProvider, () => {
  checkProviderStatus();
});

// Emit events to parent
const emit = defineEmits([
  'message-sent',
  'model-selected',
]);

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
  console.log(
    `[StreamDebug][Renderer][ChatInput][${streamDebugRequestId.value || 'unknown'}] stopStreaming requested`
  );

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
  if (!configured) {
    alert(`Please configure the ${selectedProvider.value.name} API key in Settings.`);
    return;
  }

  const userMessage = message.value.trim();
  message.value = '';
  isLoading.value = true;
  isStopping.value = false;
  streamDebugRequestId.value = `req-${Date.now()}`;
  console.log(
    `[StreamDebug][Renderer][ChatInput][${streamDebugRequestId.value}] sendMessage provider=${selectedProvider.value.type} model=${selectedModel.value} toolMode=${isAutoToolMode.value ? 'auto' : 'manual'} toolCount=${isAutoToolMode.value ? 0 : selectedTools.value.length} skillMode=${isAutoSkillMode.value ? 'auto' : 'manual'} skillCount=${isAutoSkillMode.value ? 0 : selectedSkillIds.value.length} promptLen=${userMessage.length}`
  );

  // Emit message-sent and wait for ChatView to finish thread/message setup.
  await new Promise<void>(resolve => {
    let resolved = false;
    const done = () => {
      if (resolved) return;
      resolved = true;
      resolve();
    };

    emit('message-sent', userMessage, selectedModel.value, selectedTools.value, done);
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
      tools:
        isAutoToolMode.value
          ? undefined
          : selectedTools.value.length > 0
          ? JSON.parse(JSON.stringify(selectedTools.value))
          : [],
      skillMode: isAutoSkillMode.value ? 'auto' : 'manual',
      skillIds: isAutoSkillMode.value ? undefined : JSON.parse(JSON.stringify(selectedSkillIds.value)),
      threadId: props.threadId,
    });

    if (streamResult?.success === false) {
      throw new Error(streamResult?.error || 'Stream failed');
    }

    if (streamResult?.awaitingApproval) {
      console.log(
        `[StreamDebug][Renderer][ChatInput][${streamDebugRequestId.value}] awaitingApproval=true pause-for-user-approval`
      );
      isLoading.value = false;
      isStopping.value = false;
    } else {
      isLoading.value = false;
      isStopping.value = false;
    }
    console.log(
      `[StreamDebug][Renderer][ChatInput][${streamDebugRequestId.value}] chat.stream resolved`
    );
  } catch (error: any) {
    console.error('Failed to send message:', error);
    isLoading.value = false;
    isStopping.value = false;
    // Remove the user message if failed (it was already added to chat.messages in ChatView)
    // The error handler will clean up the state
  }
};

onMounted(async () => {
  await loadAvailableProviders();
  await loadSpeechStatus();
  await loadAvailableTools();
  await loadAvailableSkills();
});

onUnmounted(() => {
  if (toolSelectorCloseTimer.value !== null) {
    window.clearTimeout(toolSelectorCloseTimer.value);
    toolSelectorCloseTimer.value = null;
  }
  if (skillSelectorCloseTimer.value !== null) {
    window.clearTimeout(skillSelectorCloseTimer.value);
    skillSelectorCloseTimer.value = null;
  }
  if (speechErrorTimer.value !== null) {
    window.clearTimeout(speechErrorTimer.value);
    speechErrorTimer.value = null;
  }
  clearRecordingTimeout();
  stopVoiceInput();
  stopWaveform();
});
</script>
<style scoped>
.chat-input-outer {
  padding: var(--chat-composer-padding, 10px);
}

.chat-input-container {
  border-color: var(--border-color);
  background-color: var(--bg-tertiary);
}

.text-primary {
  color: var(--text-primary);
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

.text-secondary {
  color: var(--text-secondary);
}

.text-accent {
  color: var(--accent-color);
}

.text-danger {
  color: var(--danger-color);
}

.stop-btn {
  background-color: rgba(239, 68, 68, 0.18);
}

.stop-btn:hover:not(:disabled) {
  background-color: rgba(239, 68, 68, 0.28);
  color: #ffffff;
}

.is-stopping {
  opacity: 0.75;
}

.is-transcribing {
  animation: micPulse 1.2s ease-in-out infinite;
}

.icon-btn:hover {
  background-color: var(--bg-hover);
  color: var(--text-primary);
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

/* Specific overrides for badges */
.bg-\[\#4a9eff\] {
  background-color: var(--accent-color);
}

.bg-secondary {
  background-color: var(--bg-secondary);
}

.bg-tertiary {
  background-color: var(--bg-tertiary);
}

.bg-hover\/50 {
  background-color: rgba(var(--accent-rgb, 74, 158, 255), 0.1);
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

.max-h-64 {
  max-height: 16rem;
}

.shadow-xl {
  box-shadow:
    0 20px 25px -5px rgba(0, 0, 0, 0.2),
    0 10px 10px -5px rgba(0, 0, 0, 0.1);
}

button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.tool-mode-btn {
  font-size: 12px;
  padding: 6px 10px;
  border-radius: 10px;
  border: 1px solid var(--border-color);
  background: rgba(255, 255, 255, 0.03);
  color: var(--text-secondary);
}

.tool-mode-btn.active {
  background: rgba(var(--accent-rgb, 74, 158, 255), 0.18);
  border-color: rgba(var(--accent-rgb, 74, 158, 255), 0.35);
  color: var(--text-primary);
}

.tool-action-btn {
  font-size: 11px;
  padding: 6px 10px;
  border-radius: 10px;
  border: 1px solid var(--border-color);
  background: transparent;
  color: var(--text-secondary);
}

.tool-action-btn:hover:not(:disabled) {
  background-color: var(--bg-hover);
  color: var(--text-primary);
}
</style>
