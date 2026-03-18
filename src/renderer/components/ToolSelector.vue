<template>
  <div
    class="relative"
    @mouseenter="openToolSelector"
    @mouseleave="scheduleCloseToolSelector"
  >
    <button
      class="relative h-8 w-8 rounded-lg text-secondary flex items-center justify-center icon-btn"
      :class="{ 'text-accent': isAutoToolMode || selectedTools.length > 0 }"
      @click="showToolSelector = !showToolSelector"
      @mouseenter="openToolSelector"
      @mouseleave="scheduleCloseToolSelector"
    >
      <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z"
        />
      </svg>
      <span
        v-if="isAutoToolMode || selectedTools.length > 0"
        class="absolute right-0 top-0 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-[#4a9eff] text-[9px] text-white"
      >
        {{ isAutoToolMode ? 'A' : selectedTools.length }}
      </span>
    </button>

    <!-- Tool Selector Menu -->
    <div
      v-if="showToolSelector"
      class="absolute bottom-full left-0 mb-2 w-80 rounded-xl border border-color bg-secondary shadow-xl z-50 overflow-hidden"
      @mouseenter="openToolSelector"
      @mouseleave="scheduleCloseToolSelector"
    >
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
        <button
          v-for="tool in availableTools"
          :key="tool.name"
          class="w-full text-left px-3 py-2 text-sm rounded-lg hover:bg-hover flex items-center justify-between group"
          :disabled="isAutoToolMode"
          :class="{
            'text-accent bg-hover/50': isToolSelected(tool.name) && !isAutoToolMode,
            'opacity-60 cursor-not-allowed': isAutoToolMode,
          }"
          @click="toggleTool(tool.name)"
        >
          <div class="flex flex-col">
            <span class="font-medium">{{ tool.name }}</span>
            <span class="text-[10px] text-muted truncate max-w-[180px]">
              {{ tool.description }}
            </span>
          </div>
          <div
            class="flex h-4 w-4 items-center justify-center rounded border border-color"
            :class="{ 'bg-accent border-accent': isToolSelected(tool.name) && !isAutoToolMode }"
          >
            <svg
              v-if="isToolSelected(tool.name) && !isAutoToolMode"
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
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';

interface ToolSummary {
  name: string;
  description?: string;
}

interface ElectronToolsApi {
  tools?: {
    list?: () => Promise<unknown>;
  };
}

const props = defineProps<{
  tools: string[];
  mode: 'manual' | 'auto';
}>();

const emit = defineEmits<{
  (event: 'update:tools', value: string[]): void;
  (event: 'update:mode', value: 'manual' | 'auto'): void;
}>();

const electronAPI = (window as Window & { electronAPI?: ElectronToolsApi }).electronAPI;

const showToolSelector = ref(false);
const availableTools = ref<ToolSummary[]>([]);
const toolSelectorCloseTimer = ref<number | null>(null);
const isAutoToolMode = computed(() => props.mode === 'auto');
const selectedTools = computed(() => props.tools);

const normalizeTools = (input: unknown): ToolSummary[] => {
  if (!Array.isArray(input)) return [];
  return input
    .map((tool: unknown) => {
      if (!tool || typeof tool !== 'object') return null;
      const name = (tool as { name?: unknown }).name;
      const description = (tool as { description?: unknown }).description;
      if (typeof name !== 'string' || name.trim().length === 0) return null;
      return {
        name,
        description: typeof description === 'string' ? description : '',
      };
    })
    .filter((tool): tool is ToolSummary => Boolean(tool));
};

const loadAvailableTools = async () => {
  try {
    const tools = await electronAPI?.tools?.list?.();
    const normalized = normalizeTools(tools);
    availableTools.value = normalized;
    if (selectedTools.value.length === 0 && normalized.length > 0) {
      emit('update:tools', normalized.map(tool => tool.name));
    }
  } catch (error) {
    console.error('Failed to load tools:', error);
    availableTools.value = [];
  }
};

const toggleAutoToolMode = () => {
  emit('update:mode', isAutoToolMode.value ? 'manual' : 'auto');
};

const isToolSelected = (toolName: string) => selectedTools.value.includes(toolName);

const toggleTool = (toolName: string) => {
  if (isAutoToolMode.value) return;
  const next = isToolSelected(toolName)
    ? selectedTools.value.filter(name => name !== toolName)
    : [...selectedTools.value, toolName];
  emit('update:tools', next);
};

const selectAllTools = () => {
  if (isAutoToolMode.value) return;
  emit('update:tools', availableTools.value.map(tool => tool.name));
};

const clearAllTools = () => {
  if (isAutoToolMode.value) return;
  emit('update:tools', []);
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

onMounted(() => {
  void loadAvailableTools();
});

onUnmounted(() => {
  if (toolSelectorCloseTimer.value !== null) {
    window.clearTimeout(toolSelectorCloseTimer.value);
    toolSelectorCloseTimer.value = null;
  }
});
</script>

<style scoped>
.text-primary {
  color: var(--text-primary);
}

.text-secondary {
  color: var(--text-secondary);
}

.text-muted {
  color: var(--text-muted);
}

.text-accent {
  color: var(--accent-color);
}

.border-color {
  border-color: var(--border-color);
}

.bg-secondary {
  background-color: var(--bg-secondary);
}

.bg-tertiary {
  background-color: var(--bg-tertiary);
}

.shadow-xl {
  box-shadow:
    0 20px 25px -5px rgba(0, 0, 0, 0.2),
    0 10px 10px -5px rgba(0, 0, 0, 0.1);
}

.icon-btn:hover {
  background-color: var(--bg-hover);
  color: var(--text-primary);
}

.bg-\[\#4a9eff\] {
  background-color: var(--accent-color);
}

.bg-hover\/50 {
  background-color: rgba(var(--accent-rgb, 74, 158, 255), 0.1);
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

button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
