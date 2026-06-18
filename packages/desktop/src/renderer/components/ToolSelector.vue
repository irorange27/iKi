<template>
  <div class="relative" @mouseenter="openToolSelector" @mouseleave="scheduleCloseToolSelector">
    <button
      class="composer-control-btn composer-selector-trigger ui-text-secondary relative flex h-10 w-10 items-center justify-center rounded-[14px]"
      :class="{
        'ui-text-accent':
          isAutoToolMode || selectedTools.length > 0 || selectedMcpServerIds.length > 0,
      }"
      :title="triggerTitle"
      :aria-label="triggerTitle"
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
        v-if="isAutoToolMode || selectedTools.length > 0 || selectedMcpServerIds.length > 0"
        class="selector-badge"
      >
        {{ isAutoToolMode ? 'A' : selectedTools.length + selectedMcpServerIds.length }}
      </span>
    </button>

    <div
      v-if="showToolSelector"
      class="selector-panel"
      @mouseenter="openToolSelector"
      @mouseleave="scheduleCloseToolSelector"
    >
      <div class="selector-panel-header">
        <div class="flex items-center justify-between">
          <span class="selector-panel-title ui-text-primary">{{ t('chat.tools.title') }}</span>
        </div>
        <div class="selector-panel-description ui-text-muted">
          {{ t('chat.tools.description') }}
        </div>

        <div class="selector-panel-toolbar">
          <button
            class="selector-mode-btn"
            :class="{ active: isAutoToolMode }"
            @click="toggleAutoToolMode"
          >
            {{ t('chat.tools.auto') }}
          </button>
          <div class="selector-toolbar-spacer" />
          <button
            class="selector-action-btn"
            :disabled="isAutoToolMode"
            @click="selectAllBuiltinTools"
          >
            {{ t('chat.tools.selectAll') }}
          </button>
          <button class="selector-action-btn" :disabled="isAutoToolMode" @click="clearBuiltinTools">
            {{ t('chat.tools.clear') }}
          </button>
        </div>

        <div v-if="isAutoToolMode" class="ui-text-accent mt-2 text-xs leading-snug">
          {{ t('chat.tools.autoDescription') }}
        </div>
      </div>

      <div class="selector-list">
        <div v-if="builtinTools.length === 0" class="selector-empty-state">
          {{ t('chat.tools.noBuiltins') }}
        </div>
        <button
          v-for="tool in builtinTools"
          :key="tool.name"
          class="selector-item"
          :disabled="isAutoToolMode"
          :class="{
            'selector-item-selected': isBuiltinToolSelected(tool.name) && !isAutoToolMode,
            'selector-item-disabled': isAutoToolMode,
          }"
          @click="toggleBuiltinTool(tool.name)"
        >
          <div class="selector-item-copy">
            <span class="font-medium">{{ tool.displayName || tool.name }}</span>
            <span class="selector-item-description selector-item-description-truncate">
              {{ tool.description }}
            </span>
          </div>
          <div
            class="selector-check"
            :class="{ 'selector-check-active': isBuiltinToolSelected(tool.name) }"
          >
            <svg
              v-if="isBuiltinToolSelected(tool.name)"
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

        <div v-if="showMcpSection" class="selector-subsection">
          <div class="selector-subsection-header">
            <button type="button" class="selector-section-toggle" @click="toggleMcpSection">
              <svg
                class="ui-text-secondary h-4 w-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M8 7V5a2 2 0 114 0v2m4 0h1a2 2 0 012 2v2a2 2 0 01-2 2h-1m-8-6H7a2 2 0 00-2 2v2a2 2 0 002 2h1m8 0v2a2 2 0 11-4 0v-2m-4 0v2a2 2 0 104 0v-2"
                />
              </svg>
              <span class="ui-text-primary text-sm font-semibold">{{
                t('chat.tools.mcpServers')
              }}</span>
              <svg
                class="selector-chevron h-4 w-4"
                :class="{ expanded: isMcpSectionExpanded }"
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

            <button
              class="selector-icon-btn"
              :disabled="mcpServersLoading"
              :title="t('chat.tools.refreshMcpTitle')"
              :aria-label="t('chat.tools.refreshMcpTitle')"
              @click.stop="refreshMcpServers"
            >
              <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0A8.003 8.003 0 015.17 15m14.249 0H15"
                />
              </svg>
            </button>
          </div>

          <template v-if="isMcpSectionExpanded">
            <div class="selector-subsection-description ui-text-muted">
              {{ t('chat.tools.mcpDescription') }}
            </div>

            <div class="selector-panel-toolbar">
              <button class="selector-action-btn" @click="selectAllMcpServers">
                {{ t('chat.tools.selectAll') }}
              </button>
              <button class="selector-action-btn" @click="clearAllMcpServers">
                {{ t('chat.tools.clear') }}
              </button>
            </div>

            <div v-if="mcpServersLoading" class="mt-3 selector-empty-state">
              {{ t('chat.tools.loadingMcp') }}
            </div>
            <div v-else-if="mcpServerEntries.length === 0" class="mt-3 selector-empty-state">
              {{ t('chat.tools.noMcp') }}
            </div>
            <div v-else class="mt-3 selector-section-stack">
              <button
                v-for="server in mcpServerEntries"
                :key="server.id"
                class="selector-item"
                :class="{
                  'selector-item-selected': isMcpServerSelected(server.id),
                  'selector-item-disabled': !server.selectable,
                }"
                :disabled="!server.selectable"
                @click="toggleMcpServer(server.id)"
              >
                <div class="selector-item-copy">
                  <span class="font-medium">{{ server.name }}</span>
                  <span class="selector-item-description selector-item-description-wide">
                    <span :class="server.statusToneClass">{{ server.statusLabel }}</span>
                    <span v-if="server.meta"> · {{ server.meta }}</span>
                  </span>
                </div>
                <div
                  class="selector-check"
                  :class="{ 'selector-check-active': isMcpServerSelected(server.id) }"
                >
                  <svg
                    v-if="isMcpServerSelected(server.id)"
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
          </template>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { toRef } from 'vue';

import { useToolSelector } from '../composables/useToolSelector';

const props = defineProps<{
  tools: string[];
  mcpServerIds: string[];
  mode: 'manual' | 'auto';
}>();

const emit = defineEmits<{
  (event: 'update:tools', value: string[]): void;
  (event: 'update:mcpServerIds', value: string[]): void;
  (event: 'update:mode', value: 'manual' | 'auto'): void;
}>();
const {
  builtinTools,
  clearAllMcpServers,
  clearBuiltinTools,
  isAutoToolMode,
  isBuiltinToolSelected,
  isMcpSectionExpanded,
  isMcpServerSelected,
  mcpServerEntries,
  mcpServersLoading,
  openToolSelector,
  refreshMcpServers,
  scheduleCloseToolSelector,
  selectAllBuiltinTools,
  selectAllMcpServers,
  selectedMcpServerIds,
  selectedTools,
  showMcpSection,
  showToolSelector,
  t,
  toggleAutoToolMode,
  toggleBuiltinTool,
  toggleMcpSection,
  toggleMcpServer,
  triggerTitle,
} = useToolSelector({
  tools: toRef(props, 'tools'),
  mcpServerIds: toRef(props, 'mcpServerIds'),
  mode: toRef(props, 'mode'),
  emitSelection: payload => {
    if (payload.mode) {
      emit('update:mode', payload.mode);
    }
    if (payload.mcpServerIds) {
      emit('update:mcpServerIds', payload.mcpServerIds);
    }
    if (payload.tools) {
      emit('update:tools', payload.tools);
    }
  },
});
</script>

<style scoped>
.selector-subsection {
  margin-top: 8px;
  border-top: 1px solid var(--border-color);
  padding-top: 12px;
}

.selector-subsection-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.selector-subsection-description {
  margin-top: 12px;
  font-size: 12px;
  line-height: 1.4;
}

.selector-section-toggle {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--text-primary);
  cursor: pointer;
}

.selector-chevron {
  color: var(--text-muted);
  transition: transform 0.18s ease;
}

.selector-chevron.expanded {
  transform: rotate(180deg);
}

.status-connected {
  color: var(--status-success-color);
}

.status-error {
  color: var(--status-danger-color);
}

.status-idle {
  color: var(--text-muted);
}

button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
