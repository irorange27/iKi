<template>
  <div class="flex h-screen app-background app-text">
    <Sidebar
      ref="sidebarRef"
      @thread-selected="selectThread"
      @new-chat="handleNewChat"
      @thread-deleted="handleThreadDeleted"
    />

    <!-- Main Content -->
    <div class="flex flex-1 flex-col">
      <!-- Header -->
      <div class="flex items-center justify-center p-4">
        <div class="flex items-center gap-1 text-sm text-secondary">
          <span>{{ chat.messages.length }} messages</span>
          <span v-if="currentThread">·</span>
          <FolderOpen v-if="currentThread" :size="12" />
          <span v-if="currentThread">{{ currentThread.title }}</span>
        </div>
      </div>

      <!-- Main Area -->
      <div
        class="chat-main-area flex flex-1 items-center justify-center overflow-y-auto"
        ref="messagesContainer"
      >
        <WelcomeScreen v-if="showWelcome && chat.messages.length === 0" @new-chat="handleNewChat" />

        <!-- Messages List -->
        <div v-else class="messages-area w-full h-full">
          <div class="messages-container" @click="handleMarkdownClick">
            <div
              v-for="(m, index) in chat.messages"
              :key="m.id ? m.id : index"
              class="message-wrapper"
              :class="m.role"
            >
              <div class="message-shell">
                <div
                  v-if="m.role === 'assistant' && hasReferenceSummary(m)"
                  class="reference-summary"
                >
                  <button
                    v-if="getContextReferenceCount(m) > 0"
                    type="button"
                    class="reference-summary-item"
                    :class="{ 'is-active': getExpandedReferenceCategory(m) === 'context' }"
                    :title="getContextReferenceTooltip(m)"
                    @click.stop="toggleReferencePanel(m, 'context')"
                  >
                    <Layers3 :size="14" class="reference-summary-icon" />
                    context
                  </button>
                  <button
                    v-if="getMemoryReferenceCount(m) > 0"
                    type="button"
                    class="reference-summary-item"
                    :class="{ 'is-active': getExpandedReferenceCategory(m) === 'memory' }"
                    :title="getMemoryReferenceTooltip(m)"
                    @click.stop="toggleReferencePanel(m, 'memory')"
                  >
                    <Brain :size="14" class="reference-summary-icon" />
                    {{ getMemoryReferenceCount(m) }} memories
                  </button>
                  <button
                    v-if="getToolReferenceCount(m) > 0"
                    type="button"
                    class="reference-summary-item"
                    :class="{ 'is-active': getExpandedReferenceCategory(m) === 'tools' }"
                    :title="getToolReferenceTooltip(m)"
                    @click.stop="toggleReferencePanel(m, 'tools')"
                  >
                    <Wrench :size="14" class="reference-summary-icon" />
                    {{ getToolReferenceCount(m) }} tools
                  </button>
                  <button
                    v-if="getSkillReferenceCount(m) > 0"
                    type="button"
                    class="reference-summary-item"
                    :class="{ 'is-active': getExpandedReferenceCategory(m) === 'skills' }"
                    :title="getSkillReferenceTooltip(m)"
                    @click.stop="toggleReferencePanel(m, 'skills')"
                  >
                    <Sparkles :size="14" class="reference-summary-icon" />
                    {{ getSkillReferenceCount(m) }} skills
                  </button>
                </div>
                <div
                  v-if="m.role === 'assistant' && getExpandedReferenceCategory(m)"
                  class="reference-panel"
                >
                  <div v-if="getExpandedReferenceCategory(m) === 'tools'">
                    <div class="reference-panel-label">Tools</div>
                    <ul class="reference-panel-list">
                      <li
                        v-for="entry in getToolReferenceItems(m)"
                        :key="entry.name"
                        class="reference-panel-item"
                      >
                        <span class="reference-panel-item-name">{{ entry.name }}</span>
                        <span class="reference-panel-item-meta">{{ entry.count }} calls</span>
                      </li>
                    </ul>
                  </div>
                  <div v-else-if="getExpandedReferenceCategory(m) === 'skills'">
                    <div class="reference-panel-label">Skills</div>
                    <ul class="reference-panel-list">
                      <li
                        v-for="skill in getSkillReferenceItems(m)"
                        :key="skill.id"
                        class="reference-panel-item reference-panel-item-action"
                      >
                        <button
                          type="button"
                          class="reference-panel-link"
                          @click="openSkillReference(skill.id)"
                        >
                          <span class="reference-panel-item-name">{{ skill.name }}</span>
                          <span class="reference-panel-item-meta">{{ skill.sourceLabel }}</span>
                          <span v-if="skill.description" class="reference-panel-item-description">
                            {{ skill.description }}
                          </span>
                          <ExternalLink :size="13" class="reference-panel-link-icon" />
                        </button>
                      </li>
                    </ul>
                  </div>
                  <div v-else-if="getExpandedReferenceCategory(m) === 'memory'">
                    <div class="reference-panel-label">Memory</div>
                    <div v-if="getMemoryReferenceQuery(m)" class="reference-panel-query">
                      {{ getMemoryReferenceQuery(m) }}
                    </div>
                    <ul class="reference-panel-list">
                      <li
                        v-for="entry in getMemoryReferenceItems(m)"
                        :key="entry.id || entry.summary"
                        class="reference-panel-item"
                      >
                        <div class="reference-panel-item-row">
                          <span v-if="entry.score !== null" class="reference-panel-score">
                            {{ formatMemoryMatchScore(entry.score) }}
                          </span>
                          <span
                            v-if="entry.sourceMessageCount !== null"
                            class="reference-panel-item-meta"
                          >
                            {{ formatMemorySourceCount(entry.sourceMessageCount) }}
                          </span>
                          <span v-if="entry.updatedAt" class="reference-panel-item-meta">
                            {{ formatShortTimestamp(entry.updatedAt) }}
                          </span>
                        </div>
                        <div class="reference-panel-item-description">
                          {{ entry.summary }}
                        </div>
                        <div v-if="entry.tags.length > 0" class="reference-panel-tags">
                          <span v-for="tag in entry.tags" :key="tag" class="reference-panel-tag">
                            {{ tag }}
                          </span>
                        </div>
                      </li>
                    </ul>
                  </div>
                  <div v-else-if="getExpandedReferenceCategory(m) === 'context'">
                    <div class="reference-panel-label">Context</div>
                    <div class="reference-panel-query">
                      {{ getContextReferenceHeadline(m) }}
                    </div>
                    <ul class="reference-panel-list">
                      <li
                        v-for="entry in getContextReferenceItems(m)"
                        :key="`${entry.kind}-${entry.status}`"
                        class="reference-panel-item"
                      >
                        <div class="reference-panel-item-row">
                          <span class="reference-panel-item-name">{{ entry.kind }}</span>
                          <span class="reference-panel-item-meta">{{ entry.status }}</span>
                          <span
                            v-if="entry.estimatedTokens !== null"
                            class="reference-panel-item-meta"
                          >
                            {{ entry.estimatedTokens }} tok
                          </span>
                          <span
                            v-if="entry.sourceCount !== null"
                            class="reference-panel-item-meta"
                          >
                            {{ entry.sourceCount }} src
                          </span>
                        </div>
                        <div v-if="entry.reason" class="reference-panel-item-description">
                          {{ entry.reason }}
                        </div>
                      </li>
                    </ul>
                  </div>
                </div>
                <div class="message-content">
                  <div
                    v-for="(part, partIndex) in m.parts"
                    :key="getPartRenderKey(m.id || String(index), part, partIndex)"
                    class="message-part"
                  >
                    <div v-if="isStreamingTextPart(m as any, part)" class="message-text">
                      {{ getTextPartContent(part) }}
                    </div>
                    <div v-else-if="isTextPart(part)" class="message-text markdown-content">
                      <VueMarkdown :source="getTextPartContent(part)" :plugins="markdownPlugins" />
                    </div>
                    <div
                      v-else-if="shouldHideReferencePart(part)"
                      class="reference-part-hidden"
                      aria-hidden="true"
                    ></div>
                    <div v-else-if="isApprovalRequestedPart(part)" class="tool-approval-content">
                      <div class="tool-approval-header">
                        <svg
                          class="tool-icon"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="2"
                            d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                          />
                          <path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="2"
                            d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                          />
                        </svg>
                        <span class="tool-approval-title">Tool Approval Request</span>
                      </div>
                      <div class="tool-approval-body">
                        <div class="tool-name">
                          {{ getToolName(part) }}
                        </div>
                        <div class="tool-args">
                          <pre>{{ formatJson(getToolInput(part)) }}</pre>
                        </div>
                      </div>
                      <div class="tool-approval-actions">
                        <button
                          class="approve-btn"
                          @click="handleToolApproval(m as any, part as any, true)"
                          :disabled="isApprovalProcessing(part)"
                        >
                          Approve
                        </button>
                        <button
                          class="reject-btn"
                          @click="handleToolApproval(m as any, part as any, false)"
                          :disabled="isApprovalProcessing(part)"
                        >
                          Reject
                        </button>
                      </div>
                    </div>
                    <div
                      v-else-if="isToolResultPart(part)"
                      class="tool-result-content"
                      :class="{ 'tool-card-collapsed': isToolCollapsed(part) }"
                    >
                      <div class="tool-card-header">
                        <span class="tool-card-tag tag-result">Tool Result</span>
                        <div class="tool-card-lead">
                          <component
                            :is="getToolIconComponent(part)"
                            :size="16"
                            class="tool-card-lead-icon"
                          />
                          <span class="tool-card-title">{{ getToolTitle(part) }}</span>
                          <span class="tool-card-tool">{{ getToolName(part) }}</span>
                          <span v-if="getMcpServerLabel(part)" class="tool-card-server">
                            MCP Server: {{ getMcpServerLabel(part) }}
                          </span>
                        </div>
                        <div class="tool-card-meta">
                          <span
                            v-if="getToolStateLabel(part)"
                            class="tool-state-pill"
                            :class="getToolStatePillClass(part)"
                          >
                            <CheckCircle
                              v-if="getToolStateKind(part) === 'success'"
                              :size="14"
                              class="tool-state-icon"
                            />
                            <XCircle
                              v-else-if="getToolStateKind(part) === 'error'"
                              :size="14"
                              class="tool-state-icon"
                            />
                            <ShieldBan
                              v-else-if="getToolStateKind(part) === 'denied'"
                              :size="14"
                              class="tool-state-icon"
                            />
                            <CircleHelp
                              v-else-if="getToolStateKind(part) === 'pending'"
                              :size="14"
                              class="tool-state-icon"
                            />
                            <Loader2
                              v-else-if="getToolStateKind(part) === 'running'"
                              :size="14"
                              class="tool-state-icon tool-icon-spin"
                            />
                            <span>{{ getToolStateLabel(part) }}</span>
                          </span>
                          <span v-if="getToolDurationLabel(part)" class="tool-duration">
                            <Clock :size="14" class="tool-duration-icon" />
                            <span>{{ getToolDurationLabel(part) }}</span>
                          </span>
                          <button
                            v-if="canToggleToolCollapse(part)"
                            type="button"
                            class="tool-collapse-btn"
                            :aria-label="
                              isToolCollapsed(part)
                                ? 'Expand tool details'
                                : 'Collapse tool details'
                            "
                            @click.stop="toggleToolCollapse(m as any, part as any)"
                          >
                            <ChevronDown
                              :size="16"
                              class="tool-collapse-icon"
                              :class="{ 'is-expanded': !isToolCollapsed(part) }"
                            />
                          </button>
                        </div>
                      </div>
                      <div v-if="!isToolCollapsed(part)">
                        <div v-if="hasWebSearchCitations(part)" class="tool-card-section">
                          <div class="tool-card-section-title">References</div>
                          <ol class="tool-citations">
                            <li
                              v-for="citation in getWebSearchCitations(part)"
                              :key="citation.url"
                              class="tool-citation"
                            >
                              <a :href="citation.url" target="_blank" rel="noopener noreferrer">
                                {{ citation.title }}
                              </a>
                              <span v-if="citation.domain" class="tool-citation-domain">{{
                                citation.domain
                              }}</span>
                            </li>
                          </ol>
                        </div>
                        <div v-if="hasDisplayValue(getToolInput(part))" class="tool-card-section">
                          <div class="tool-card-section-title">
                            {{ getToolInputDisplayTitle(part) }}
                          </div>
                          <pre class="tool-json-output">{{
                            formatJson(getToolInputDisplayValue(part))
                          }}</pre>
                          <div v-if="getToolInputDisplayMetaText(part)" class="tool-input-meta">
                            {{ getToolInputDisplayMetaText(part) }}
                          </div>
                        </div>
                        <div v-if="hasDisplayValue(getToolOutput(part))" class="tool-card-section">
                          <div class="tool-card-section-title">Output</div>
                          <pre class="tool-json-output">{{ formatJson(getToolOutput(part)) }}</pre>
                        </div>
                      </div>
                      <div
                        v-if="getToolCallIdFromPart(part) && !isToolCollapsed(part)"
                        class="tool-card-footer"
                      >
                        <span class="tool-call-id">
                          Call ID:
                          <span class="tool-call-id-value">{{ getToolCallIdFromPart(part) }}</span>
                        </span>
                      </div>
                    </div>
                    <div
                      v-else-if="isToolCallPart(part)"
                      class="tool-call-content"
                      :class="{ 'tool-card-collapsed': isToolCollapsed(part) }"
                    >
                      <div class="tool-card-header">
                        <span class="tool-card-tag tag-call">Tool Call</span>
                        <div class="tool-card-lead">
                          <component
                            :is="getToolIconComponent(part)"
                            :size="16"
                            class="tool-card-lead-icon"
                          />
                          <span class="tool-card-title">{{ getToolTitle(part) }}</span>
                          <span class="tool-card-tool">{{ getToolName(part) }}</span>
                          <span v-if="getMcpServerLabel(part)" class="tool-card-server">
                            MCP Server: {{ getMcpServerLabel(part) }}
                          </span>
                        </div>
                        <div class="tool-card-meta">
                          <span
                            v-if="getToolStateLabel(part)"
                            class="tool-state-pill"
                            :class="getToolStatePillClass(part)"
                          >
                            <CheckCircle
                              v-if="getToolStateKind(part) === 'success'"
                              :size="14"
                              class="tool-state-icon"
                            />
                            <XCircle
                              v-else-if="getToolStateKind(part) === 'error'"
                              :size="14"
                              class="tool-state-icon"
                            />
                            <ShieldBan
                              v-else-if="getToolStateKind(part) === 'denied'"
                              :size="14"
                              class="tool-state-icon"
                            />
                            <CircleHelp
                              v-else-if="getToolStateKind(part) === 'pending'"
                              :size="14"
                              class="tool-state-icon"
                            />
                            <Loader2
                              v-else-if="getToolStateKind(part) === 'running'"
                              :size="14"
                              class="tool-state-icon tool-icon-spin"
                            />
                            <span>{{ getToolStateLabel(part) }}</span>
                          </span>
                          <span v-if="getToolDurationLabel(part)" class="tool-duration">
                            <Clock :size="14" class="tool-duration-icon" />
                            <span>{{ getToolDurationLabel(part) }}</span>
                          </span>
                          <button
                            v-if="canToggleToolCollapse(part)"
                            type="button"
                            class="tool-collapse-btn"
                            :aria-label="
                              isToolCollapsed(part)
                                ? 'Expand tool details'
                                : 'Collapse tool details'
                            "
                            @click.stop="toggleToolCollapse(m as any, part as any)"
                          >
                            <ChevronDown
                              :size="16"
                              class="tool-collapse-icon"
                              :class="{ 'is-expanded': !isToolCollapsed(part) }"
                            />
                          </button>
                        </div>
                      </div>
                      <div v-if="!isToolCollapsed(part)">
                        <div v-if="hasDisplayValue(getToolInput(part))" class="tool-card-section">
                          <div class="tool-card-section-title">Arguments</div>
                          <pre class="tool-json-output">{{ formatJson(getToolInput(part)) }}</pre>
                        </div>
                      </div>
                      <div
                        v-if="getToolCallIdFromPart(part) && !isToolCollapsed(part)"
                        class="tool-card-footer"
                      >
                        <span class="tool-call-id">
                          Call ID:
                          <span class="tool-call-id-value">{{ getToolCallIdFromPart(part) }}</span>
                        </span>
                      </div>
                    </div>
                    <div v-else class="tool-fallback-content">
                      <pre class="tool-json-output">{{ formatJson(part) }}</pre>
                    </div>
                  </div>
                </div>
                <div v-if="m.role === 'user'" class="message-actions">
                  <button
                    class="message-action-btn"
                    type="button"
                    data-tooltip="Edit"
                    aria-label="Edit"
                    @click.stop="beginEditMessage(m as any)"
                  >
                    <Pencil class="message-action-icon" :size="14" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Input Area -->
      <div class="composer-area">
        <div v-if="editingUserMessageId" class="edit-banner">
          <div class="edit-banner-text">
            <strong>Editing a previous message.</strong> Resending will remove later messages in
            this thread.
          </div>
          <button class="edit-banner-cancel" type="button" @click="cancelEditing">Cancel</button>
        </div>
        <ChatInput
          ref="chatInputRef"
          :chat="chat"
          :thread-id="currentThread?.id || ''"
          @message-sent="handleMessageSent"
          @model-selected="handleModelSelected"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Chat } from '@ai-sdk/vue';
import type { UIMessage } from 'ai';
import { ref, nextTick, onMounted, onUnmounted } from 'vue';
import Sidebar from '../components/Sidebar.vue';
import WelcomeScreen from '../components/WelcomeScreen.vue';
import ChatInput from '../components/ChatInput.vue';
import {
  Brain,
  CheckCircle,
  ChevronDown,
  CircleHelp,
  Clock,
  ExternalLink,
  FolderOpen,
  Layers3,
  Loader2,
  Pencil,
  ShieldBan,
  Sparkles,
  Wrench,
  XCircle,
} from 'lucide-vue-next';
import {
  canToggleToolCollapse,
  formatJson,
  getToolCallIdFromPart,
  getToolDurationLabel,
  getToolIconComponent,
  getToolInput,
  getToolInputDisplayMetaText,
  getToolInputDisplayTitle,
  getToolInputDisplayValue,
  getToolName,
  getToolOutput,
  getToolStateKind,
  getToolStateLabel,
  getToolStatePillClass,
  getToolTitle,
  getWebSearchCitations,
  hasDisplayValue,
  hasWebSearchCitations,
  isApprovalRequestedPart,
  isToolCallPart,
  isToolCollapsed,
  isToolResultPart,
  toggleToolCollapse,
} from '../modules/chat/ui_message_tool_parts';
import {
  getContextReferenceSummary,
  getMemoryReferenceSummary,
  getSkillReferenceSummary,
  getToolReferenceSummary,
  hasReferenceSummary,
} from '../modules/chat/ui_message_references';
import { createUiMessagePersistence } from '../modules/chat/ui_message_persistence';
import { createChatMessageStore } from '../modules/chat/chat_message_store';
import { isTextPart } from '../modules/chat/ui_message_text';
import {
  isContextReportPart,
  isMemoryPart,
  isObjectRecord,
  isSkillUsagePart,
} from '../../shared/chat/message_parts';
import { useConfigStore } from '../store/config';
import { useChatThreads } from '../composables/useChatThreads';
import { useChatStreaming } from '../composables/useChatStreaming';
import VueMarkdown from 'vue-markdown-render';
import { markdownCodeBlockPlugin } from '../utils/markdown_code_block_plugin';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const window: any;

const electronAPI = window.electronAPI as any;

const configStore = useConfigStore();

// Create Chat instance for message management (without API endpoint for Electron)
const chat = new Chat({});
const messagesContainer = ref<HTMLElement | null>(null);
const sidebarRef = ref<InstanceType<typeof Sidebar> | null>(null);
const chatInputRef = ref<any>(null);
const persistence = createUiMessagePersistence({ electronAPI });
const messageStore = createChatMessageStore(chat);

const createMessageId = () => `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

type ToolSource = {
  kind?: 'builtin' | 'mcp';
  id?: string;
  name?: string;
};

const toolSourceMap = ref<Map<string, ToolSource>>(new Map());
const toolSourceLoading = ref(false);

const loadToolSources = async () => {
  if (toolSourceLoading.value) return;
  toolSourceLoading.value = true;
  try {
    if (!electronAPI?.tools?.list) return;
    const list = await electronAPI.tools.list();
    if (!Array.isArray(list)) return;
    const next = new Map<string, ToolSource>();
    for (const item of list) {
      if (!item || typeof item !== 'object') continue;
      const name = (item as { name?: unknown }).name;
      if (typeof name !== 'string' || !name.trim()) continue;
      const source = (item as { source?: unknown }).source;
      if (source && typeof source === 'object') {
        next.set(name, source as ToolSource);
      }
    }
    toolSourceMap.value = next;
  } catch (error) {
    console.warn('Failed to load tool metadata:', error);
  } finally {
    toolSourceLoading.value = false;
  }
};

const getMcpServerLabel = (part: unknown): string => {
  const toolName = getToolName(part);
  if (!toolName) return '';
  const source = toolSourceMap.value.get(toolName);
  if (!source && (toolName.startsWith('mcp_') || toolName.startsWith('mcp:'))) {
    void loadToolSources();
  }
  if (source?.kind !== 'mcp') return '';
  return source.name || source.id || '';
};

const formatShortTimestamp = (value: string): string => {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return value;
  return new Date(parsed).toLocaleDateString();
};

type ReferenceCategory = 'tools' | 'skills' | 'memory' | 'context';

const expandedReferencePanels = ref<Record<string, ReferenceCategory | null>>({});

const getReferenceMessageKey = (message: UIMessage): string => message.id || '';

const getExpandedReferenceCategory = (message: UIMessage): ReferenceCategory | null => {
  const key = getReferenceMessageKey(message);
  return key ? (expandedReferencePanels.value[key] ?? null) : null;
};

const toggleReferencePanel = (message: UIMessage, category: ReferenceCategory) => {
  const key = getReferenceMessageKey(message);
  if (!key) return;
  expandedReferencePanels.value = {
    ...expandedReferencePanels.value,
    [key]: expandedReferencePanels.value[key] === category ? null : category,
  };
};

const getToolReferenceCount = (message: UIMessage): number =>
  getToolReferenceSummary(message).count;

const getToolReferenceItems = (message: UIMessage) => getToolReferenceSummary(message).items;

const getToolReferenceTooltip = (message: UIMessage): string => {
  const summary = getToolReferenceSummary(message);
  return summary.names.length > 0
    ? `Tools: ${summary.names.join(', ')}`
    : 'Tools used in this reply';
};

const getSkillReferenceCount = (message: UIMessage): number =>
  getSkillReferenceSummary(message).items.length;

const getSkillReferenceItems = (message: UIMessage) => getSkillReferenceSummary(message).items;

const getSkillReferenceTooltip = (message: UIMessage): string => {
  const summary = getSkillReferenceSummary(message);
  if (summary.items.length === 0) return 'No skills used';
  return summary.items.map(skill => skill.name).join(', ');
};

const getMemoryReferenceCount = (message: UIMessage): number =>
  getMemoryReferenceSummary(message).items.length;

const getMemoryReferenceItems = (message: UIMessage) => getMemoryReferenceSummary(message).items;

const getMemoryReferenceQuery = (message: UIMessage): string =>
  getMemoryReferenceSummary(message).query;

const getMemoryReferenceTooltip = (message: UIMessage): string => {
  const summary = getMemoryReferenceSummary(message);
  return summary.query ? `Memory query: ${summary.query}` : 'Memory references used in this reply';
};

const getContextReferenceCount = (message: UIMessage): number =>
  getContextReferenceSummary(message).items.length;

const getContextReferenceItems = (message: UIMessage) => getContextReferenceSummary(message).items;

const getContextReferenceHeadline = (message: UIMessage): string => {
  const summary = getContextReferenceSummary(message);
  const parts: string[] = [];
  if (summary.totalEstimatedTokens !== null) {
    parts.push(`${summary.totalEstimatedTokens} estimated tokens`);
  }
  if (summary.retainedRecentMessages !== null) {
    parts.push(`${summary.retainedRecentMessages} recent messages kept`);
  }
  if (summary.compactedMessages !== null && summary.compactedMessages > 0) {
    parts.push(`${summary.compactedMessages} compacted`);
  }
  return parts.join(' · ') || 'Context assembly report';
};

const getContextReferenceTooltip = (message: UIMessage): string => {
  const summary = getContextReferenceSummary(message);
  if (summary.items.length === 0) return 'No context report';
  return getContextReferenceHeadline(message);
};

const formatMemoryMatchScore = (score: number): string => `${score.toFixed(3)} match`;

const formatMemorySourceCount = (count: number): string =>
  `${count} source ${count === 1 ? 'message' : 'messages'}`;

const openSkillReference = async (skillId: string) => {
  try {
    const result = await electronAPI?.skills?.openSkill?.(skillId);
    if (result?.success) return;
    console.warn('Failed to open skill:', result?.error || skillId);
  } catch (error) {
    console.warn('Failed to open skill:', error);
  }
};

const shouldHideReferencePart = (part: unknown): boolean =>
  isSkillUsagePart(part) || isMemoryPart(part) || isContextReportPart(part);

const markdownPlugins = [markdownCodeBlockPlugin];

const getPartType = (part: unknown): string =>
  isObjectRecord(part) && typeof part.type === 'string' ? part.type : 'unknown';

const getPartRenderKey = (messageId: string, part: unknown, partIndex: number): string => {
  const partType = getPartType(part);
  if (isTextPart(part)) {
    return `${messageId}-${partType}-${partIndex}-${part.text.length}-${streamController.streamRenderTick.value}`;
  }
  return `${messageId}-${partType}-${partIndex}`;
};

const getTextPartContent = (part: unknown): string => {
  // Re-render streaming text even if the part object is mutated in-place.
  void streamController.streamRenderTick.value;
  return isTextPart(part) ? part.text : '';
};

const copyTextToClipboard = async (text: string): Promise<boolean> => {
  if (!text) return false;

  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      const copied = document.execCommand('copy');
      document.body.removeChild(textarea);
      return copied;
    } catch {
      return false;
    }
  }
};

const handleMarkdownClick = async (event: MouseEvent) => {
  const target = event.target;
  if (!(target instanceof Element)) return;

  const copyButton = target.closest('.md-code-copy-btn') as HTMLButtonElement | null;
  if (!copyButton) return;

  const codeElement = copyButton.closest('.md-code-block')?.querySelector('pre code');
  const codeText = codeElement?.textContent ?? '';
  if (!codeText.trim()) return;

  const copied = await copyTextToClipboard(codeText);
  if (!copied) return;

  copyButton.dataset.copied = 'true';
  window.setTimeout(() => {
    delete copyButton.dataset.copied;
  }, 1200);
};

const scrollToBottom = () => {
  nextTick(() => {
    if (messagesContainer.value) {
      messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight;
    }
  });
};

const {
  currentThread,
  currentModel,
  selectedTools,
  showWelcome,
  refreshThreads,
  createNewThread,
  selectThread: selectThreadBase,
  handleThreadDeleted: handleThreadDeletedBase,
  handleNewChat: handleNewChatBase,
  handleModelSelected,
  getCurrentThreadId,
  handleAssistantMessagePersisted,
  handleTaskPush,
} = useChatThreads({
  electronAPI,
  messageStore,
  persistence,
  sidebarRef,
  scrollToBottom,
});

const streaming = useChatStreaming({
  electronAPI,
  messageStore,
  persistence,
  createMessageId,
  scrollToBottom,
  getCurrentThreadId,
  onAssistantMessagePersisted: handleAssistantMessagePersisted,
  currentThread,
  currentModel,
  selectedTools,
  showWelcome,
  createNewThread,
  selectThread: selectThreadBase,
  handleThreadDeleted: handleThreadDeletedBase,
  handleNewChat: handleNewChatBase,
});

const streamController = streaming.streamController;
const editingUserMessageId = streaming.editingUserMessageId;
const isApprovalProcessing = streaming.isApprovalProcessing;
const handleToolApproval = streaming.handleToolApproval;
const handleMessageSent = streaming.handleMessageSent;
const isStreamingTextPart = streaming.isStreamingTextPart;
const selectThread = streaming.selectThread;
const handleThreadDeleted = streaming.handleThreadDeleted;
const handleNewChat = streaming.handleNewChat;

const beginEditMessage = async (message: UIMessage) => {
  const setDraft = async (text: string) => {
    await chatInputRef.value?.setDraftMessage(text, { focus: true, select: true });
  };
  await streaming.beginEditMessage(message, setDraft);
};

const cancelEditing = async () => {
  const clearDraft = async () => {
    await chatInputRef.value?.setDraftMessage('', { focus: true });
  };
  await streaming.cancelEditing(clearDraft);
};

// Listen for model selection from ChatInput
onMounted(async () => {
  // Initialize config store if not already initialized
  if (!configStore.initialized) {
    await configStore.initialize();
  }
  // Load threads on mount
  await refreshThreads();
  await loadToolSources();

  electronAPI.chat.removeAllListeners();
  electronAPI.chat.onUiChunk((chunk: unknown) => {
    void streamController.handleUiChunk(chunk);
  });

  try {
    electronAPI.tasks?.removeAllListeners?.();
    electronAPI.tasks?.onPush?.((payload: unknown) => {
      void handleTaskPush(payload);
    });
  } catch {
    // Ignore missing tasks IPC in older builds.
  }
});

onUnmounted(() => {
  electronAPI.chat.removeAllListeners();
  try {
    electronAPI.tasks?.removeAllListeners?.();
  } catch {
    // ignore
  }
});
</script>

<style scoped>
.app-background {
  background-color: var(--bg-primary);
}

.app-text {
  color: var(--text-primary);
}

.text-secondary {
  color: var(--text-secondary);
}

.text-muted {
  color: var(--text-muted);
}

/* Messages styles */
.messages-area {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}

.chat-main-area {
  padding: var(--chat-content-padding, 24px);
}

.messages-container {
  width: 100%;
  max-width: 860px;
  margin: 0 auto;
}

.message-wrapper {
  margin-bottom: var(--chat-message-gap, 18px);
}

.message-shell {
  position: relative;
}

.reference-summary {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 14px;
  margin-bottom: 8px;
}

.reference-summary-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0;
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: 13px;
  color: var(--reference-inline-color, var(--text-secondary));
  text-decoration: underline;
  text-decoration-style: dotted;
  text-decoration-color: var(--reference-inline-underline, rgba(127, 152, 170, 0.42));
  text-underline-offset: 4px;
}

.reference-summary-item:hover,
.reference-summary-item.is-active {
  color: var(--reference-inline-hover, var(--reference-inline-color, var(--text-primary)));
  text-decoration-color: var(
    --reference-inline-underline,
    rgba(127, 152, 170, 0.42)
  );
}

.reference-summary-icon {
  flex-shrink: 0;
}

.reference-panel {
  margin-bottom: 12px;
  padding: 10px 0 0;
  border-top: 1px solid color-mix(in srgb, var(--border-color) 90%, transparent);
}

.reference-panel-label {
  margin-bottom: 8px;
  font-size: 11px;
  font-weight: 650;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.reference-panel-query {
  margin-bottom: 10px;
  font-size: 12px;
  color: var(--text-secondary);
  overflow-wrap: anywhere;
}

.reference-panel-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 8px;
}

.reference-panel-item {
  display: grid;
  gap: 6px;
  padding: 10px 12px;
  border-radius: 12px;
  background: color-mix(in srgb, var(--bg-secondary) 82%, transparent);
  border: 1px solid color-mix(in srgb, var(--border-color) 90%, transparent);
}

.reference-panel-item-action {
  padding: 0;
  overflow: hidden;
}

.reference-panel-link {
  width: 100%;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 4px 10px;
  align-items: start;
  padding: 10px 12px;
  border: none;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.reference-panel-link:hover {
  background: color-mix(in srgb, var(--accent-color) 5%, transparent);
}

.reference-panel-link-icon {
  grid-column: 2 / 3;
  grid-row: 1 / span 2;
  align-self: center;
  color: var(--text-muted);
}

.reference-panel-item-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.reference-panel-item-name {
  font-size: 13px;
  font-weight: 650;
  color: var(--text-primary);
}

.reference-panel-item-meta {
  font-size: 11px;
  color: var(--text-muted);
}

.reference-panel-item-description {
  font-size: 12px;
  line-height: 1.55;
  color: var(--text-secondary);
}

.reference-panel-score {
  display: inline-flex;
  align-items: center;
  padding: 3px 7px;
  border-radius: 999px;
  font-weight: 650;
  color: var(--accent-color);
  background: color-mix(in srgb, var(--accent-color) 10%, transparent);
}

.reference-panel-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.reference-panel-tag {
  display: inline-flex;
  align-items: center;
  padding: 4px 8px;
  border-radius: 999px;
  font-size: 11px;
  color: var(--text-secondary);
  border: 1px solid var(--border-color);
  background: var(--bg-secondary);
}

.reference-part-hidden {
  display: none;
}

.message-wrapper.user .message-shell {
  margin-left: auto;
  width: fit-content;
  max-width: min(85%, 760px);
}

.message-wrapper.assistant .message-shell {
  max-width: min(100%, 760px);
  margin-right: clamp(0px, 4vw, 56px);
}

.message-actions {
  display: flex;
  justify-content: flex-start;
  gap: 8px;
  position: absolute;
  left: 10px;
  bottom: -18px;
  opacity: 0;
  pointer-events: none;
  transform: translateY(4px);
  transition:
    opacity 0.15s ease,
    transform 0.15s ease;
  z-index: 10;
}

.message-wrapper.user .message-content:hover + .message-actions,
.message-wrapper.user .message-actions:hover {
  opacity: 1;
  pointer-events: auto;
  transform: translateY(0);
}

.message-action-btn {
  border: 1px solid var(--border-color);
  background: color-mix(in srgb, var(--bg-tertiary) 82%, transparent);
  color: var(--text-secondary);
  width: 28px;
  height: 28px;
  border-radius: 10px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  position: relative;
}

.message-action-btn:hover {
  color: var(--text-primary);
  background: var(--bg-hover);
}

.message-action-btn::after {
  content: attr(data-tooltip);
  position: absolute;
  left: 50%;
  bottom: calc(100% + 8px);
  white-space: nowrap;
  padding: 6px 8px;
  border-radius: 10px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  box-shadow: 0 10px 22px rgba(0, 0, 0, 0.18);
  color: var(--text-primary);
  font-size: 12px;
  letter-spacing: 0.01em;
  opacity: 0;
  transform: translate(-50%, 4px);
  pointer-events: none;
  transition:
    opacity 0.15s ease,
    transform 0.15s ease;
}

.message-action-btn:hover::after {
  opacity: 1;
  transform: translate(-50%, 0);
}

.message-action-icon {
  display: block;
}

.composer-area {
  width: 100%;
}

.edit-banner {
  width: 100%;
  max-width: 860px;
  margin: 0 auto 8px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border-radius: 12px;
  padding: 10px 12px;
  border: 1px solid var(--border-color);
  background: var(--bg-tertiary);
  color: var(--text-secondary);
  font-size: 12px;
}

.edit-banner strong {
  color: var(--text-primary);
  font-weight: 650;
}

.edit-banner-cancel {
  border: 1px solid var(--border-color);
  background: transparent;
  color: var(--text-secondary);
  padding: 6px 10px;
  border-radius: 999px;
  cursor: pointer;
  flex-shrink: 0;
}

.edit-banner-cancel:hover {
  color: var(--text-primary);
  background: var(--bg-hover);
}

.message-wrapper.user .message-content {
  background: var(--chat-user-bubble-background);
  border: 1px solid var(--chat-user-bubble-border-color);
  border-radius: var(--chat-user-bubble-radius, 28px);
  padding: var(--chat-bubble-padding-y, 12px) var(--chat-bubble-padding-x, 16px);
  box-shadow: var(--chat-user-bubble-shadow);
}

.message-wrapper.assistant .message-content {
  background: var(--bg-primary);
  border-radius: 12px;
  padding: var(--chat-bubble-padding-y, 12px) var(--chat-bubble-padding-x, 16px);
}

.message-text {
  color: var(--text-primary);
  font-size: var(--font-size);
  line-height: 1.72;
  letter-spacing: 0.01em;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.message-text.markdown-content {
  white-space: normal;
}

.message-wrapper.user .message-text {
  color: var(--chat-user-bubble-text);
}

.message-part + .message-part {
  margin-top: 12px;
}

.message-text.markdown-content :deep(p) {
  margin: 0 0 0.9em;
}

.message-text.markdown-content :deep(h1),
.message-text.markdown-content :deep(h2),
.message-text.markdown-content :deep(h3) {
  margin: 1.2em 0 0.6em;
  line-height: 1.4;
  color: var(--text-primary);
  font-weight: 650;
}

.message-text.markdown-content :deep(h1) {
  font-size: 1.3em;
}

.message-text.markdown-content :deep(h2) {
  font-size: 1.18em;
}

.message-text.markdown-content :deep(h3) {
  font-size: 1.05em;
}

.message-text.markdown-content :deep(ul),
.message-text.markdown-content :deep(ol) {
  margin: 0.7em 0 0.95em 1.25em;
  padding: 0;
}

.message-text.markdown-content :deep(ul) {
  list-style: disc;
  list-style-position: outside;
}

.message-text.markdown-content :deep(ol) {
  list-style: decimal;
  list-style-position: outside;
}

.message-text.markdown-content :deep(li + li) {
  margin-top: 0.28em;
}

.message-text.markdown-content :deep(blockquote) {
  margin: 0.95em 0;
  padding: 0.5em 0.9em;
  border-left: 3px solid var(--accent-color);
  border-radius: 0 8px 8px 0;
  background: var(--bg-secondary);
  color: var(--text-secondary);
}

.message-text.markdown-content :deep(a) {
  color: var(--accent-color);
  text-decoration: none;
  border-bottom: 1px dashed color-mix(in srgb, var(--accent-color) 55%, transparent);
  transition:
    color 0.2s ease,
    border-color 0.2s ease;
}

.message-text.markdown-content :deep(a:hover) {
  color: var(--accent-hover);
  border-bottom-color: var(--accent-hover);
}

.message-wrapper.user .message-text.markdown-content :deep(a) {
  color: var(--chat-user-bubble-text);
  border-bottom-color: rgba(255, 255, 255, 0.45);
}

.message-wrapper.user .message-text.markdown-content :deep(a:hover) {
  color: #ffffff;
  border-bottom-color: rgba(255, 255, 255, 0.72);
}

.message-wrapper.user .message-text.markdown-content :deep(blockquote) {
  border-left-color: rgba(255, 255, 255, 0.55);
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.9);
}

.message-wrapper.user .message-text.markdown-content :deep(code) {
  background: rgba(255, 255, 255, 0.12);
  border-color: rgba(255, 255, 255, 0.18);
  color: var(--chat-user-bubble-text);
}

.message-text.markdown-content :deep(hr) {
  margin: 1.1em 0;
  border: 0;
  border-top: 1px solid var(--border-color);
}

.message-text.markdown-content :deep(table) {
  width: 100%;
  margin: 0.9em 0;
  border-collapse: collapse;
  font-size: 0.93em;
}

.message-text.markdown-content :deep(th),
.message-text.markdown-content :deep(td) {
  padding: 0.45em 0.65em;
  border: 1px solid var(--border-color);
  text-align: left;
  vertical-align: top;
}

.message-text.markdown-content :deep(th) {
  background: var(--bg-tertiary);
  color: var(--text-primary);
  font-weight: 600;
}

.message-text.markdown-content :deep(p:last-child) {
  margin-bottom: 0;
}

.message-text.markdown-content :deep(pre) {
  margin: 10px 0;
  padding: 12px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 10px;
  overflow-x: auto;
}

.message-text.markdown-content :deep(code) {
  font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
  font-size: 0.9em;
  background: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  padding: 1px 6px;
}

.message-text.markdown-content :deep(pre code) {
  display: block;
  background: transparent;
  border: none;
  border-radius: 0;
  padding: 0;
  font-size: 12px;
  color: var(--text-primary);
}

.message-text.markdown-content :deep(.md-code-block) {
  margin: 12px 0;
  border: 1px solid var(--border-color);
  border-radius: 14px;
  overflow: hidden;
  background: var(--bg-secondary);
}

.message-text.markdown-content :deep(.md-code-header) {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 14px;
  background: var(--bg-hover);
  border-bottom: 1px solid var(--border-color);
}

.message-text.markdown-content :deep(.md-code-lang) {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--text-secondary);
  font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
  text-transform: lowercase;
}

.message-text.markdown-content :deep(.md-code-lang::before) {
  content: '⌘';
  font-size: 12px;
  color: var(--accent-color);
}

.message-text.markdown-content :deep(.md-code-copy-btn) {
  border: 1px solid transparent;
  background: transparent;
  color: var(--text-secondary);
  width: 28px;
  height: 28px;
  border-radius: 8px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
}

.message-text.markdown-content :deep(.md-code-copy-btn:hover) {
  color: var(--text-primary);
  background: var(--bg-tertiary);
  border-color: var(--border-color);
}

.message-text.markdown-content :deep(.md-code-copy-btn[data-copied='true']) {
  color: var(--success-color, var(--accent-color));
}

.message-text.markdown-content :deep(.md-code-copy-btn svg) {
  width: 15px;
  height: 15px;
}

.message-text.markdown-content :deep(.md-code-block pre) {
  margin: 0;
  padding: 10px 14px;
  border: none;
  border-radius: 0;
  background: var(--bg-primary);
}

.message-text.markdown-content :deep(.md-code-block pre code) {
  font-size: 13px;
  line-height: 1.55;
  white-space: pre;
  color: var(--text-primary);
}

.message-text.markdown-content :deep(.md-code-block pre code.hljs) {
  background: transparent;
  margin: 0;
  padding: 0 !important;
}

@media (max-width: 768px) {
  .chat-main-area {
    padding: max(10px, calc(var(--chat-content-padding, 24px) - 8px));
  }

  .messages-container {
    max-width: 100%;
  }

  .message-wrapper.user .message-shell,
  .message-wrapper.assistant .message-shell {
    max-width: 100%;
  }

  .message-wrapper.assistant .message-shell {
    margin-right: 0;
  }

  .message-text {
    font-size: calc(var(--font-size) - 1px);
    line-height: 1.68;
  }

  .message-actions {
    opacity: 1;
    pointer-events: auto;
    transform: translateY(0);
  }
}

.typing-cursor {
  display: inline-block;
  color: var(--accent-color);
  animation: blink 1s infinite;
  margin-left: 2px;
}

@keyframes blink {
  0%,
  100% {
    opacity: 1;
  }

  50% {
    opacity: 0.3;
  }
}

.tool-approval-content,
.tool-call-content,
.tool-result-content,
.tool-fallback-content {
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 12px;
  padding: 14px;
  max-width: 680px;
}

.tool-card-header {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 10px;
}

.tool-card-tag {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  border-radius: 999px;
  padding: 2px 8px;
}

.tag-call {
  color: var(--accent-color);
  background: var(--bg-tertiary);
}

.tag-result {
  color: var(--success-color, var(--accent-color));
  background: var(--bg-tertiary);
}

.tool-card-lead {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex: 1 1 auto;
}

.tool-card-lead-icon {
  flex-shrink: 0;
  opacity: 0.9;
}

.tool-card-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  min-width: 0;
  flex: 1 1 auto;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tool-card-tool {
  flex-shrink: 0;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: var(--text-muted);
  background: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  border-radius: 999px;
  padding: 2px 8px;
  font-family:
    ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New',
    monospace;
}

.tool-card-server {
  display: block;
  margin-top: 4px;
  font-size: 11px;
  color: var(--text-secondary);
}

.tool-card-meta {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
  white-space: nowrap;
}

.tool-state-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 2px 10px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  border: 1px solid var(--border-color);
  background: var(--bg-tertiary);
  color: var(--text-secondary);
}

.tool-state-pill.tool-state-success {
  color: var(--success-color, var(--accent-color));
  border-color: color-mix(
    in srgb,
    var(--success-color, var(--accent-color)) 55%,
    var(--border-color)
  );
  background: color-mix(in srgb, var(--success-color, var(--accent-color)) 12%, var(--bg-tertiary));
}

.tool-state-pill.tool-state-error {
  color: var(--danger-color);
  border-color: color-mix(in srgb, var(--danger-color) 55%, var(--border-color));
  background: color-mix(in srgb, var(--danger-color) 10%, var(--bg-tertiary));
}

.tool-state-pill.tool-state-denied {
  color: var(--text-muted);
  border-color: color-mix(in srgb, var(--text-muted) 55%, var(--border-color));
  background: color-mix(in srgb, var(--text-muted) 10%, var(--bg-tertiary));
}

.tool-state-pill.tool-state-pending,
.tool-state-pill.tool-state-running {
  color: var(--accent-color);
  border-color: color-mix(in srgb, var(--accent-color) 55%, var(--border-color));
  background: color-mix(in srgb, var(--accent-color) 10%, var(--bg-tertiary));
}

.tool-state-icon {
  opacity: 0.95;
}

.tool-icon-spin {
  animation: tool-spin 0.9s linear infinite;
}

@keyframes tool-spin {
  from {
    transform: rotate(0deg);
  }

  to {
    transform: rotate(360deg);
  }
}

.tool-duration {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-secondary);
  opacity: 0.9;
}

.tool-duration-icon {
  opacity: 0.85;
}

.tool-input-meta {
  margin-top: 6px;
  font-size: 11px;
  line-height: 1.4;
  color: var(--text-muted);
}

.tool-collapse-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 10px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  transition:
    background 0.15s ease,
    border-color 0.15s ease,
    color 0.15s ease;
}

.tool-collapse-btn:hover {
  background: var(--bg-hover);
  border-color: var(--border-color);
  color: var(--text-primary);
}

.tool-collapse-icon {
  transition: transform 0.18s ease;
}

.tool-collapse-icon.is-expanded {
  transform: rotate(180deg);
}

.tool-card-collapsed .tool-card-header {
  margin-bottom: 0;
}

.tool-card-section + .tool-card-section {
  margin-top: 10px;
}

.tool-card-footer {
  margin-top: 10px;
  padding-top: 8px;
  border-top: 1px solid var(--border-color);
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  font-size: 11px;
  color: var(--text-muted);
}

.tool-call-id {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.tool-call-id-value {
  font-family:
    ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New',
    monospace;
  color: var(--text-secondary);
  overflow-wrap: anywhere;
}

.tool-card-section-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted);
  margin-bottom: 6px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.tool-citations {
  margin: 0;
  padding-left: 18px;
  color: var(--text-primary);
  display: grid;
  gap: 6px;
}

.tool-citation {
  font-size: 13px;
  line-height: 1.5;
  color: var(--text-primary);
}

.tool-citation a {
  color: var(--accent-color);
  text-decoration: none;
  border-bottom: 1px dashed color-mix(in srgb, var(--accent-color) 55%, transparent);
  transition:
    color 0.2s ease,
    border-color 0.2s ease;
}

.tool-citation a:hover {
  color: var(--accent-hover);
  border-bottom-color: var(--accent-hover);
}

.tool-citation-domain {
  margin-left: 8px;
  font-size: 11px;
  color: var(--text-muted);
}

.tool-json-output {
  margin: 0;
  padding: 12px;
  background: var(--bg-tertiary);
  border-radius: 8px;
  border: 1px solid var(--border-color);
  font-size: 12px;
  line-height: 1.5;
  overflow-x: auto;
  white-space: pre;
  color: var(--text-secondary);
  font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
}

.tool-approval-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
  font-weight: 600;
  color: var(--text-primary);
}

.tool-icon {
  width: 20px;
  height: 20px;
  color: var(--accent-color);
}

.tool-approval-title {
  font-size: 14px;
}

.tool-approval-body {
  margin-bottom: 12px;
}

.tool-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 10px;
}

.tool-args {
  margin: 0;
}

.tool-args pre {
  margin: 0;
  padding: 12px;
  background: var(--bg-tertiary);
  border-radius: 8px;
  border: 1px solid var(--border-color);
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-secondary);
  font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
  overflow-x: auto;
  white-space: pre;
}

.tool-approval-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}

.approve-btn,
.reject-btn {
  padding: 8px 16px;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
  border: none;
}

.approve-btn {
  background: var(--accent-color);
  color: white;
}

.approve-btn:hover:not(:disabled) {
  opacity: 0.9;
}

.reject-btn {
  background: var(--bg-tertiary);
  color: var(--text-primary);
}

.reject-btn:hover:not(:disabled) {
  background: var(--bg-hover);
}

.approve-btn:disabled,
.reject-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
