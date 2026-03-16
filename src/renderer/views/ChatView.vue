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
      <div class="chat-main-area flex flex-1 items-center justify-center overflow-y-auto" ref="messagesContainer">
        <WelcomeScreen v-if="showWelcome && chat.messages.length === 0" @new-chat="handleNewChat" />

        <!-- Messages List -->
          <div v-else class="messages-area w-full h-full">
          <div class="messages-container" @click="handleMarkdownClick">
            <div v-for="(m, index) in chat.messages" :key="m.id ? m.id : index" class="message-wrapper" :class="m.role">
              <div class="message-shell">
                <div
                  v-if="m.role === 'assistant' && getUsedToolNames(m).length > 0"
                  class="tool-usage-summary"
                >
                  <span class="tool-usage-label">Tools used</span>
                  <span
                    v-for="toolName in getUsedToolNames(m)"
                    :key="toolName"
                    class="tool-usage-pill"
                  >
                    {{ toolName }}
                  </span>
                </div>
                <div class="message-content">
                  <div v-for="(part, partIndex) in m.parts" :key="getPartRenderKey(m.id || String(index), part, partIndex)"
                    class="message-part">
                  <div v-if="isStreamingTextPart(m as any, part)" class="message-text">
                    {{ getTextPartContent(part) }}
                  </div>
                  <div v-else-if="isTextPart(part)" class="message-text markdown-content">
                    <VueMarkdown :source="getTextPartContent(part)" :plugins="markdownPlugins" />
                  </div>
                  <div v-else-if="isApprovalRequestedPart(part)" class="tool-approval-content">
                    <div class="tool-approval-header">
                      <svg class="tool-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                          d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                          d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
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
                      <button class="approve-btn" @click="handleToolApproval(m as any, part as any, true)"
                        :disabled="isApprovalProcessing(part)">
                        Approve
                      </button>
                      <button class="reject-btn" @click="handleToolApproval(m as any, part as any, false)"
                        :disabled="isApprovalProcessing(part)">
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
                          :aria-label="isToolCollapsed(part) ? 'Expand tool details' : 'Collapse tool details'"
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
                          <li v-for="citation in getWebSearchCitations(part)" :key="citation.url" class="tool-citation">
                            <a :href="citation.url" target="_blank" rel="noopener noreferrer">
                              {{ citation.title }}
                            </a>
                            <span v-if="citation.domain" class="tool-citation-domain">{{ citation.domain }}</span>
                          </li>
                        </ol>
                      </div>
                      <div v-if="hasDisplayValue(getToolInput(part))" class="tool-card-section">
                        <div class="tool-card-section-title">{{ getToolInputDisplayTitle(part) }}</div>
                        <pre class="tool-json-output">{{ formatJson(getToolInputDisplayValue(part)) }}</pre>
                        <div v-if="getToolInputDisplayMetaText(part)" class="tool-input-meta">
                          {{ getToolInputDisplayMetaText(part) }}
                        </div>
                      </div>
                      <div v-if="hasDisplayValue(getToolOutput(part))" class="tool-card-section">
                        <div class="tool-card-section-title">Output</div>
                        <pre class="tool-json-output">{{ formatJson(getToolOutput(part)) }}</pre>
                      </div>
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
                          :aria-label="isToolCollapsed(part) ? 'Expand tool details' : 'Collapse tool details'"
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
            <strong>Editing a previous message.</strong> Resending will remove later messages in this thread.
          </div>
          <button class="edit-banner-cancel" type="button" @click="cancelEditing">
            Cancel
          </button>
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
import type { UIMessage, UIMessageChunk } from 'ai';
import { ref, nextTick, onMounted, onUnmounted } from 'vue';
import { storeToRefs } from 'pinia';
import Sidebar from '../components/Sidebar.vue';
import WelcomeScreen from '../components/WelcomeScreen.vue';
import ChatInput from '../components/ChatInput.vue';
import {
  CheckCircle,
  ChevronDown,
  CircleHelp,
  Clock,
  Download,
  FilePenLine,
  FileText,
  Folder,
  FolderOpen,
  Loader2,
  Pencil,
  Search,
  ShieldBan,
  Terminal,
  Trash2,
  Wrench,
  XCircle,
} from 'lucide-vue-next';
import { useConfigStore } from '../store/config';
import VueMarkdown from 'vue-markdown-render';
import hljs from 'highlight.js/lib/common';
import 'highlight.js/styles/atom-one-dark.css';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const window: any;

const configStore = useConfigStore();
const { config } = storeToRefs(configStore);

interface ChatThread {
  id: string;
  title: string;
  model?: string;
}

const showWelcome = ref(true);
// Create Chat instance for message management (without API endpoint for Electron)
const chat = new Chat({});
const messagesContainer = ref<HTMLElement | null>(null);
const currentThread = ref<ChatThread | null>(null);
const currentModel = ref<string>('');
const selectedTools = ref<string[]>([]);
const sidebarRef = ref<InstanceType<typeof Sidebar> | null>(null);
const chatInputRef = ref<any>(null);
const activeAssistantMessageId = ref<string | null>(null);
const activeAssistantParentId = ref<string | null>(null);
const activeStreamThreadId = ref<string | null>(null);
const streamingAssistantText = ref('');
const approvalProcessing = ref<Record<string, boolean>>({});
const persistedMessageIds = new Set<string>();
const messagePersistInFlight = new Map<string, Promise<void>>();
const streamRenderTick = ref(0);
const streamRenderTraceId = ref('');
const streamRenderChunkCount = ref(0);
const streamRenderChars = ref(0);
const shouldLogStreamChunk = (count: number) => count <= 3 || count % 20 === 0;
const TITLE_REGEN_INTERVAL = 2;
const editingUserMessageId = ref<string | null>(null);

const createMessageId = () => `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

type MessagePartRecord = Record<string, any> & { type: string };
type MarkdownToken = { info?: string; content?: string };
type MarkdownFenceRenderer = (
  tokens: MarkdownToken[],
  idx: number,
  options: unknown,
  env: unknown,
  self: unknown
) => string;
type MarkdownPlugin = (md: {
  renderer: {
    rules: {
      fence?: MarkdownFenceRenderer;
      [key: string]: MarkdownFenceRenderer | undefined;
    };
  };
  utils: {
    escapeHtml: (value: string) => string;
  };
}) => void;

type MarkdownHighlightResult = {
  html: string;
  displayLanguage: string;
  languageClass: string;
};

type WebSearchCitation = {
  title: string;
  url: string;
  domain: string;
};

const isObjectRecord = (value: unknown): value is Record<string, any> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const normalizeLanguage = (value: string): string => value.trim().toLowerCase();

const sanitizeLanguageClass = (value: string): string =>
  value.replace(/[^a-z0-9_-]/gi, '');

const highlightCode = (
  source: string,
  languageHint: string,
  escapeHtml: (value: string) => string
): MarkdownHighlightResult => {
  const code = source || '';
  const hint = normalizeLanguage(languageHint);
  const safeHintClass = sanitizeLanguageClass(hint);
  const fallback: MarkdownHighlightResult = {
    html: escapeHtml(code),
    displayLanguage: hint || 'code',
    languageClass: safeHintClass || 'text',
  };

  if (!code.trim()) return fallback;

  try {
    if (hint && hljs.getLanguage(hint)) {
      return {
        html: hljs.highlight(code, { language: hint, ignoreIllegals: true }).value,
        displayLanguage: hint,
        languageClass: sanitizeLanguageClass(hint) || 'text',
      };
    }

    const autoResult = hljs.highlightAuto(code);
    const detected = normalizeLanguage(autoResult.language || '');
    const safeDetected = sanitizeLanguageClass(detected);

    return {
      html: autoResult.value || fallback.html,
      displayLanguage: hint || safeDetected || 'code',
      languageClass: safeDetected || safeHintClass || 'text',
    };
  } catch {
    return fallback;
  }
};

const markdownCodeBlockPlugin: MarkdownPlugin = md => {
  md.renderer.rules.fence = (tokens, idx) => {
    const token = tokens[idx];
    const rawInfo = typeof token?.info === 'string' ? token.info.trim() : '';
    const languageHint = rawInfo.split(/\s+/).filter(Boolean)[0] || '';
    const sourceRaw = typeof token?.content === 'string' ? token.content : '';
    const source = sourceRaw.replace(/^\n+/, '').replace(/\n+$/, '');
    const { html, displayLanguage, languageClass } = highlightCode(
      source,
      languageHint,
      md.utils.escapeHtml
    );
    const escapedLanguage = md.utils.escapeHtml(displayLanguage || 'code');
    const codeClass = md.utils.escapeHtml(languageClass || 'text');
    const renderedFence = `<pre><code class="hljs language-${codeClass}">${html}</code></pre>`;

    return `<div class="md-code-block"><div class="md-code-header"><span class="md-code-lang">${escapedLanguage}</span><button type="button" class="md-code-copy-btn" aria-label="Copy code" title="Copy code"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg></button></div>${renderedFence}</div>`;
  };
};

const markdownPlugins = [markdownCodeBlockPlugin];

const normalizeRole = (role: unknown): 'system' | 'user' | 'assistant' => {
  if (role === 'system' || role === 'assistant' || role === 'user') {
    return role;
  }
  return 'user';
};

const normalizeParts = (parts: unknown): Array<Record<string, unknown>> => {
  if (!Array.isArray(parts)) return [];
  return parts.filter(
    part => isObjectRecord(part) && typeof part.type === 'string'
  ) as Array<Record<string, unknown>>;
};

const parseStoredUiMessage = (row: { id: string; message: string }): UIMessage => {
  try {
    const parsed = JSON.parse(row.message);
    if (isObjectRecord(parsed)) {
      if (Array.isArray(parsed.parts)) {
        const parsedParts = normalizeParts(parsed.parts);
        return {
          id: row.id,
          role: normalizeRole(parsed.role),
          parts:
            parsedParts.length > 0
              ? (parsedParts as UIMessage['parts'])
              : ([{ type: 'text', text: '' }] as UIMessage['parts']),
        };
      }

      if (typeof parsed.content === 'string') {
        return {
          id: row.id,
          role: normalizeRole(parsed.role),
          parts: [{ type: 'text', text: parsed.content }],
        };
      }
    }
  } catch {
    // Fallback below.
  }

  return {
    id: row.id,
    role: 'user',
    parts: [{ type: 'text', text: row.message }],
  };
};

const extractTextFromMessage = (message: UIMessage | undefined): string => {
  if (!message || !Array.isArray(message.parts)) return '';
  return message.parts
    .filter(part => isObjectRecord(part) && part.type === 'text' && typeof part.text === 'string')
    .map(part => String(part.text))
    .join('');
};

const upsertTextIntoMessageParts = (parts: UIMessage['parts'], nextText: string): UIMessage['parts'] => {
  const nextParts: UIMessage['parts'] = [];
  let replaced = false;

  for (const part of parts) {
    if (isObjectRecord(part) && part.type === 'text') {
      if (replaced) continue;
      nextParts.push({
        ...(part as any),
        type: 'text',
        text: nextText,
        state: 'done',
      } as any);
      replaced = true;
      continue;
    }
    nextParts.push(part);
  }

  if (!replaced) {
    nextParts.unshift({ type: 'text', text: nextText, state: 'done' } as any);
  }

  return nextParts;
};

const truncateConversationAfterIndex = async (messageIndex: number) => {
  const messagesToDelete = chat.messages.slice(messageIndex + 1) as unknown as UIMessage[];
  if (!messagesToDelete.length) return;

  const idsToDelete = messagesToDelete
    .map(message => (message && typeof message.id === 'string' ? message.id : ''))
    .filter(id => id.length > 0);

  if (idsToDelete.length === 0) {
    chat.messages.splice(messageIndex + 1, chat.messages.length);
    return;
  }

  const inFlight = idsToDelete
    .map(id => messagePersistInFlight.get(id))
    .filter((promise): promise is Promise<void> => Boolean(promise));
  if (inFlight.length) {
    await Promise.allSettled(inFlight);
  }

  chat.messages.splice(messageIndex + 1, chat.messages.length);

  for (const id of idsToDelete) {
    persistedMessageIds.delete(id);
    messagePersistInFlight.delete(id);
  }

  await Promise.allSettled(idsToDelete.map(id => window.electronAPI.chat.messages.delete(id)));
};

const beginEditMessage = async (message: UIMessage) => {
  if (!message || message.role !== 'user' || typeof message.id !== 'string') return;
  await stopActiveStreamIfNeeded('edit-message');
  editingUserMessageId.value = message.id;
  const text = extractTextFromMessage(message);
  await chatInputRef.value?.setDraftMessage(text, { focus: true, select: true });
  scrollToBottom();
};

const cancelEditing = async () => {
  editingUserMessageId.value = null;
  await chatInputRef.value?.setDraftMessage('', { focus: true });
};

const upsertUiMessage = async (
  message: UIMessage,
  parentId?: string,
  source = 'unknown',
  threadIdOverride?: string
) => {
  const threadId = threadIdOverride || currentThread.value?.id;
  if (!threadId) return;

  const persistKey = message.id;
  const inFlightPersist = messagePersistInFlight.get(persistKey);
  if (inFlightPersist) {
    console.log(
      `[ChatPersist][Renderer] waiting id=${persistKey} source=${source} parent=${parentId || 'null'}`
    );
    await inFlightPersist;
  }

  const persistTask = (async () => {
    const serializedMessage = JSON.stringify(message);
    const metadata = JSON.stringify({ format: 'ai-ui-message-v1' });

    if (persistedMessageIds.has(message.id)) {
      console.log(
        `[ChatPersist][Renderer] update id=${message.id} source=${source} thread=${threadId}`
      );
      await window.electronAPI.chat.messages.update(message.id, {
        message: serializedMessage,
        metadata,
      });
      return;
    }

    console.log(
      `[ChatPersist][Renderer] create id=${message.id} source=${source} thread=${threadId} parent=${parentId || 'null'}`
    );

    try {
      const savedMessage = await window.electronAPI.chat.messages.create({
        id: message.id,
        thread_id: threadId,
        parent_id: parentId || null,
        depth: 0,
        message: serializedMessage,
        timestamp: new Date().toISOString(),
        metadata,
      });

      if (savedMessage?.id) {
        message.id = savedMessage.id;
        persistedMessageIds.add(savedMessage.id);
      } else {
        persistedMessageIds.add(message.id);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorCode =
        typeof error === 'object' && error !== null && 'code' in error
          ? String((error as { code?: unknown }).code)
          : '';
      console.warn(
        `[ChatPersist][Renderer] create-failed id=${message.id} source=${source} code=${errorCode || 'unknown'} error=${errorMessage}`
      );

      if (
        errorCode === 'SQLITE_CONSTRAINT_PRIMARYKEY' ||
        errorMessage.includes('UNIQUE constraint failed: chat_messages.id')
      ) {
        persistedMessageIds.add(message.id);
        await window.electronAPI.chat.messages.update(message.id, {
          message: serializedMessage,
          metadata,
        });
        console.warn(
          `[ChatPersist][Renderer] duplicate-resolved-via-update id=${message.id} source=${source}`
        );
        return;
      }

      throw error;
    }
  })();

  messagePersistInFlight.set(persistKey, persistTask);

  try {
    await persistTask;
  } finally {
    if (messagePersistInFlight.get(persistKey) === persistTask) {
      messagePersistInFlight.delete(persistKey);
    }
  }
};

const getAssistantMessageById = (id: string | null): UIMessage | undefined => {
  if (!id) return undefined;
  return chat.messages.find((message: any) => message.id === id) as UIMessage | undefined;
};

const getOrCreateAssistantMessage = (): UIMessage => {
  const existing = getAssistantMessageById(activeAssistantMessageId.value);
  if (existing) return existing;

  const assistantMessage: UIMessage = {
    id: createMessageId(),
    role: 'assistant',
    parts: [],
  };

  chat.messages.push(assistantMessage as any);
  activeAssistantMessageId.value = assistantMessage.id;
  return assistantMessage;
};

const TOOL_STATE_LABELS: Record<string, string> = {
  'input-streaming': 'Running',
  'input-available': 'Queued',
  'approval-requested': 'Awaiting approval',
  'approval-responded': 'Approved',
  'output-available': 'Completed',
  'output-error': 'Failed',
  'output-denied': 'Denied',
  done: 'Done',
};

const getPartType = (part: unknown): string =>
  isObjectRecord(part) && typeof part.type === 'string' ? part.type : 'unknown';

const getPartRenderKey = (messageId: string, part: unknown, partIndex: number): string => {
  const partType = getPartType(part);
  if (isTextPart(part)) {
    return `${messageId}-${partType}-${partIndex}-${part.text.length}-${streamRenderTick.value}`;
  }
  return `${messageId}-${partType}-${partIndex}`;
};

const isTextPart = (part: unknown): part is { type: 'text'; text: string } =>
  isObjectRecord(part) && part.type === 'text' && typeof part.text === 'string';

const isStreamingTextPart = (message: UIMessage, part: unknown): boolean => {
  if (!isTextPart(part)) return false;
  if (!activeAssistantMessageId.value) return false;
  if (message.id !== activeAssistantMessageId.value) return false;
  return isObjectRecord(part) && part.state === 'streaming';
};

const getTextPartContent = (part: unknown): string => {
  void streamRenderTick.value;
  return isTextPart(part) ? part.text : '';
};

const getApprovalId = (part: unknown): string | null => {
  if (!isObjectRecord(part)) return null;
  if (typeof part.approvalId === 'string') return part.approvalId;
  if (!isObjectRecord(part.approval)) return null;
  return typeof part.approval.id === 'string' ? part.approval.id : null;
};

const getToolCallIdFromPart = (part: unknown): string | null => {
  if (!isObjectRecord(part)) return null;
  if (typeof part.toolCallId === 'string' && part.toolCallId.length > 0) return part.toolCallId;
  if (typeof part.id === 'string' && part.id.length > 0) return part.id;
  if (isObjectRecord(part.toolCall) && typeof part.toolCall.toolCallId === 'string') {
    return part.toolCall.toolCallId;
  }
  return null;
};

const parseToolInputFromText = (inputText: string): unknown => {
  const trimmedInput = inputText.trim();
  if (!trimmedInput) return {};

  try {
    return JSON.parse(trimmedInput);
  } catch {
    return inputText;
  }
};

const isToolPart = (part: unknown): part is MessagePartRecord =>
  isObjectRecord(part) &&
  typeof part.type === 'string' &&
  (part.type === 'dynamic-tool' || part.type.startsWith('tool-'));

const isApprovalRequestedPart = (part: unknown): boolean => {
  if (!isToolPart(part)) return false;
  if (!getApprovalId(part)) return false;
  return part.type === 'tool-approval-request' || part.state === 'approval-requested';
};

const isToolResultPart = (part: unknown): boolean => {
  if (!isToolPart(part) || !isObjectRecord(part) || isApprovalRequestedPart(part)) return false;

  if (part.type === 'tool-result' || part.type === 'tool-approval-response') return true;
  if (part.output !== undefined || part.result !== undefined) return true;

  if (typeof part.state === 'string') {
    return (
      part.state === 'approval-responded' ||
      part.state === 'done' ||
      part.state.startsWith('output-')
    );
  }

  return false;
};

const isToolCallPart = (part: unknown): boolean =>
  isToolPart(part) && !isApprovalRequestedPart(part) && !isToolResultPart(part);

const getToolName = (part: unknown): string => {
  if (!isObjectRecord(part)) return 'tool';

  if (typeof part.toolName === 'string' && part.toolName.trim()) {
    return part.toolName;
  }

  if (isObjectRecord(part.toolCall) && typeof part.toolCall.toolName === 'string') {
    return part.toolCall.toolName;
  }

  if (part.type === 'dynamic-tool' && typeof part.toolName === 'string') {
    return part.toolName;
  }

  if (typeof part.type === 'string' && part.type.startsWith('tool-')) {
    const typeName = part.type.replace(/^tool-/, '');
    if (
      typeName === 'call' ||
      typeName === 'result' ||
      typeName === 'approval-request' ||
      typeName === 'approval-response'
    ) {
      return 'tool';
    }
    return typeName || 'tool';
  }

  return 'tool';
};

const getToolInput = (part: unknown): unknown => {
  if (!isObjectRecord(part)) return undefined;
  if (part.input !== undefined) return part.input;
  if (part.args !== undefined) return part.args;
  if (isObjectRecord(part.toolCall)) {
    if (part.toolCall.args !== undefined) return part.toolCall.args;
    if (part.toolCall.input !== undefined) return part.toolCall.input;
  }
  return undefined;
};

const getToolOutput = (part: unknown): unknown => {
  if (!isObjectRecord(part)) return undefined;

  if (part.output !== undefined) return part.output;
  if (part.result !== undefined) return part.result;

  if (part.type === 'tool-approval-response') {
    return {
      approvalId: part.approvalId,
      approved: part.approved,
      reason: part.reason,
    };
  }

  if (isObjectRecord(part.approval) && Object.keys(part.approval).length > 0) {
    return part.approval;
  }

  return undefined;
};

const getToolStateLabel = (part: unknown): string => {
  if (!isObjectRecord(part) || typeof part.state !== 'string') return '';
  return TOOL_STATE_LABELS[part.state] ?? part.state;
};

type ToolStateKind = 'success' | 'error' | 'denied' | 'pending' | 'running' | 'neutral';

const getToolStateKind = (part: unknown): ToolStateKind => {
  if (!isObjectRecord(part) || typeof part.state !== 'string') return 'neutral';

  const state = part.state;
  if (state === 'output-available' || state === 'done') return 'success';
  if (state === 'output-error') return 'error';
  if (state === 'output-denied') return 'denied';
  if (state === 'approval-requested') return 'pending';
  if (state === 'input-streaming' || state === 'input-available' || state === 'approval-responded') {
    return 'running';
  }

  return 'neutral';
};

const getToolStatePillClass = (part: unknown): string => `tool-state-${getToolStateKind(part)}`;

const coerceToTimestampMs = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;

  if (typeof value === 'string' && value.trim()) {
    const trimmed = value.trim();

    const asNumber = Number(trimmed);
    if (Number.isFinite(asNumber)) return asNumber;

    const parsedIso = Date.parse(trimmed);
    if (!Number.isNaN(parsedIso)) return parsedIso;
  }

  return null;
};

const getToolDurationMs = (part: unknown): number | null => {
  if (!isObjectRecord(part)) return null;

  const explicitDuration = coerceToTimestampMs(part.durationMs);
  if (explicitDuration !== null && explicitDuration >= 0) return explicitDuration;

  const startedAt = coerceToTimestampMs(part.startedAt);
  const endedAt = coerceToTimestampMs(part.endedAt);
  if (startedAt !== null && endedAt !== null) return Math.max(0, endedAt - startedAt);

  return null;
};

const formatDurationMs = (ms: number): string => {
  if (!Number.isFinite(ms) || ms < 0) return '';
  const secondsTotal = ms / 1000;

  const formatSeconds = (seconds: number) => {
    const fixed = seconds.toFixed(1);
    return fixed.endsWith('.0') ? fixed.slice(0, -2) : fixed;
  };

  if (secondsTotal < 60) {
    return `${formatSeconds(secondsTotal)} s`;
  }

  const minutes = Math.floor(secondsTotal / 60);
  const seconds = Math.round(secondsTotal % 60);
  return `${minutes}m ${seconds}s`;
};

const getToolDurationLabel = (part: unknown): string => {
  const ms = getToolDurationMs(part);
  if (ms === null) return '';
  return formatDurationMs(ms);
};

const normalizeToolNameKey = (value: string): string =>
  value.trim().toLowerCase().replace(/[-\s]+/g, '_');

const TOOL_ICON_COMPONENTS: Record<string, any> = {
  web: Search,
  web_search: Search,
  fetch: Download,
  shell: Terminal,
  read_file: FileText,
  write_file: FilePenLine,
  list_dir: Folder,
  delete_file: Trash2,
};

const getToolIconComponent = (part: unknown): any => {
  const rawName = getToolName(part);
  const toolKey = typeof rawName === 'string' ? normalizeToolNameKey(rawName) : 'tool';
  return TOOL_ICON_COMPONENTS[toolKey] || Wrench;
};

const normalizeSingleLineText = (value: string): string => value.replace(/\s+/g, ' ').trim();

const getPathBasename = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) return '';
  const segments = trimmed.split(/[\\/]/).filter(Boolean);
  return segments.length > 0 ? segments[segments.length - 1] : trimmed;
};

const getToolTitle = (part: unknown): string => {
  if (isObjectRecord(part) && typeof part.title === 'string' && part.title.trim()) {
    return normalizeSingleLineText(part.title);
  }

  const input = getToolInput(part);
  if (isObjectRecord(input)) {
    const descriptionCandidate =
      typeof input.description === 'string'
        ? input.description
        : typeof input.reason === 'string'
          ? input.reason
          : typeof input.rationale === 'string'
            ? input.rationale
            : '';
    if (descriptionCandidate.trim()) {
      return normalizeSingleLineText(descriptionCandidate);
    }
  }

  const rawName = getToolName(part);
  const toolKey = typeof rawName === 'string' ? normalizeToolNameKey(rawName) : 'tool';

  if (isObjectRecord(input)) {
    if (toolKey === 'web' || toolKey === 'web_search') {
      if (typeof input.query === 'string' && input.query.trim()) {
        return normalizeSingleLineText(input.query);
      }
    }

    if (toolKey === 'fetch') {
      if (typeof input.url === 'string' && input.url.trim()) {
        return normalizeSingleLineText(input.url);
      }
    }

    if (toolKey === 'shell') {
      if (typeof input.command === 'string' && input.command.trim()) {
        return normalizeSingleLineText(input.command);
      }
    }

    if (
      toolKey === 'read_file' ||
      toolKey === 'write_file' ||
      toolKey === 'list_dir' ||
      toolKey === 'delete_file'
    ) {
      if (typeof input.path === 'string' && input.path.trim()) {
        return getPathBasename(input.path);
      }
    }
  }

  if (typeof rawName === 'string' && rawName.trim()) {
    return normalizeSingleLineText(rawName);
  }

  return 'tool';
};

type ToolInputDisplay = {
  title: string;
  value: unknown;
  metaText?: string;
  isPrimary: boolean;
};

const getToolInputDisplay = (part: unknown): ToolInputDisplay => {
  const input = getToolInput(part);
  const stateKind = getToolStateKind(part);

  if (stateKind === 'success' && isObjectRecord(input)) {
    const toolKey = normalizeToolNameKey(getToolName(part));

    if (toolKey === 'shell' && typeof input.command === 'string' && input.command.trim()) {
      const meta: string[] = [];
      if (typeof input.cwd === 'string' && input.cwd.trim()) {
        meta.push(`cwd: ${normalizeSingleLineText(input.cwd)}`);
      }
      if (typeof input.timeout === 'number' && Number.isFinite(input.timeout)) {
        meta.push(`timeout: ${Math.trunc(input.timeout)} ms`);
      }

      return {
        title: 'Command',
        value: input.command.trim(),
        metaText: meta.length > 0 ? meta.join(' · ') : undefined,
        isPrimary: true,
      };
    }

    if ((toolKey === 'web' || toolKey === 'web_search') && typeof input.query === 'string' && input.query.trim()) {
      const meta: string[] = [];
      if (typeof input.limit === 'number' && Number.isFinite(input.limit)) {
        meta.push(`limit: ${Math.trunc(input.limit)}`);
      }

      return {
        title: 'Query',
        value: input.query.trim(),
        metaText: meta.length > 0 ? meta.join(' · ') : undefined,
        isPrimary: true,
      };
    }

    if (toolKey === 'fetch' && typeof input.url === 'string' && input.url.trim()) {
      const meta: string[] = [];
      if (typeof input.maxChars === 'number' && Number.isFinite(input.maxChars)) {
        meta.push(`maxChars: ${Math.trunc(input.maxChars)}`);
      }

      return {
        title: 'URL',
        value: input.url.trim(),
        metaText: meta.length > 0 ? meta.join(' · ') : undefined,
        isPrimary: true,
      };
    }

    if (
      (toolKey === 'read_file' ||
        toolKey === 'write_file' ||
        toolKey === 'list_dir' ||
        toolKey === 'delete_file') &&
      typeof input.path === 'string' &&
      input.path.trim()
    ) {
      const meta: string[] = [];
      if (toolKey === 'list_dir' && typeof input.recursive === 'boolean') {
        meta.push(`recursive: ${input.recursive ? 'true' : 'false'}`);
      }
      if (typeof input.encoding === 'string' && input.encoding.trim()) {
        meta.push(`encoding: ${normalizeSingleLineText(input.encoding)}`);
      }

      return {
        title: 'Path',
        value: input.path.trim(),
        metaText: meta.length > 0 ? meta.join(' · ') : undefined,
        isPrimary: true,
      };
    }
  }

  return {
    title: 'Input',
    value: input,
    isPrimary: false,
  };
};

const getToolInputDisplayTitle = (part: unknown): string => getToolInputDisplay(part).title;
const getToolInputDisplayValue = (part: unknown): unknown => getToolInputDisplay(part).value;
const getToolInputDisplayMetaText = (part: unknown): string => getToolInputDisplay(part).metaText ?? '';

const isToolCollapsed = (part: unknown): boolean => isObjectRecord(part) && part.collapsed === true;

const canToggleToolCollapse = (part: unknown): boolean =>
  isToolCallPart(part) || isToolResultPart(part);

const toggleToolCollapse = (message: UIMessage, part: unknown) => {
  // Collapse state is a purely UI concern; do not persist it.
  void message;
  if (!isObjectRecord(part)) return;
  part.collapsed = !isToolCollapsed(part);
};

const getUsedToolNames = (message: any): string[] => {
  const parts = Array.isArray(message?.parts) ? message.parts : [];
  const names: string[] = [];
  const seen = new Set<string>();

  for (const part of parts) {
    if (!isToolPart(part)) continue;
    const rawName = getToolName(part);
    const name = typeof rawName === 'string' ? rawName.trim() : '';
    if (!name || name === 'tool') continue;
    if (seen.has(name)) continue;
    seen.add(name);
    names.push(name);
  }

  return names;
};

const getUrlDomain = (value: string): string => {
  try {
    return new URL(value).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
};

const parseJsonIfPossible = (value: unknown): unknown => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed) return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
};

const getWebSearchCitations = (part: unknown): WebSearchCitation[] => {
  if (!isToolResultPart(part)) return [];
  const toolName = getToolName(part).toLowerCase();
  if (toolName !== 'web' && toolName !== 'web_search' && toolName !== 'web-search') {
    return [];
  }

  const outputRaw = parseJsonIfPossible(getToolOutput(part));
  if (!isObjectRecord(outputRaw)) return [];

  const results = outputRaw.results;
  if (!Array.isArray(results)) return [];

  const seen = new Set<string>();
  const citations: WebSearchCitation[] = [];

  for (const item of results) {
    if (!isObjectRecord(item)) continue;
    const url = typeof item.url === 'string' ? item.url.trim() : '';
    if (!url || seen.has(url)) continue;
    const title = typeof item.title === 'string' && item.title.trim() ? item.title.trim() : url;
    citations.push({
      title,
      url,
      domain: getUrlDomain(url),
    });
    seen.add(url);
  }

  return citations;
};

const hasWebSearchCitations = (part: unknown): boolean =>
  getWebSearchCitations(part).length > 0;

const hasDisplayValue = (value: unknown): boolean => {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (isObjectRecord(value)) return Object.keys(value).length > 0;
  return true;
};

const formatJson = (value: unknown): string => {
  if (value === undefined) return '';
  if (typeof value === 'string') {
    try {
      return JSON.stringify(JSON.parse(value), null, 2);
    } catch {
      return value;
    }
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
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

const isApprovalProcessing = (part: unknown): boolean => {
  const approvalId = getApprovalId(part);
  return approvalId ? !!approvalProcessing.value[approvalId] : false;
};

const resetTransientState = () => {
  activeAssistantMessageId.value = null;
  activeAssistantParentId.value = null;
  activeStreamThreadId.value = null;
  streamingAssistantText.value = '';
  approvalProcessing.value = {};
  streamRenderTraceId.value = '';
  streamRenderChunkCount.value = 0;
  streamRenderChars.value = 0;
};

const isStreamBoundToCurrentThread = (): boolean => {
  if (!activeStreamThreadId.value) return false;
  return currentThread.value?.id === activeStreamThreadId.value;
};

const stopActiveStreamIfNeeded = async (reason: string, targetThreadId?: string) => {
  if (!activeStreamThreadId.value) return;
  if (targetThreadId && activeStreamThreadId.value === targetThreadId) return;

  console.log(
    `[StreamDebug][Renderer][ChatView] stop-stream reason=${reason} streamThread=${activeStreamThreadId.value} currentThread=${currentThread.value?.id || 'null'} targetThread=${targetThreadId || 'null'}`
  );

  try {
    await window.electronAPI.chat.stopStream();
  } catch (error) {
    console.warn('[StreamDebug][Renderer][ChatView] stop-stream failed:', error);
  } finally {
    resetTransientState();
  }
};

const scrollToBottom = () => {
  nextTick(() => {
    if (messagesContainer.value) {
      messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight;
    }
  });
};

const createNewThread = async (model?: string) => {
  try {
    const thread = await window.electronAPI.chat.threads.create({
      title: 'New Chat',
      model: model || null,
      metadata: JSON.stringify({}),
    });
    currentThread.value = thread;
    chat.messages.splice(0, chat.messages.length);
    persistedMessageIds.clear();
    editingUserMessageId.value = null;
    resetTransientState();
    showWelcome.value = false;

    // Refresh sidebar to show new thread
    if (sidebarRef.value?.refresh) {
      await sidebarRef.value.refresh();
    }
    if (sidebarRef.value?.setCurrentThread) {
      sidebarRef.value.setCurrentThread(thread.id);
    }

    return thread;
  } catch (error) {
    console.error('Failed to create thread:', error);
    return null;
  }
};

// Load messages for a thread
const loadThreadMessages = async (threadId: string) => {
  try {
    const dbMessages = await window.electronAPI.chat.messages.list(threadId);
    persistedMessageIds.clear();
    for (const message of dbMessages) {
      persistedMessageIds.add(message.id);
    }

    const chatMessages = dbMessages.map((message: any) => parseStoredUiMessage(message));
    chat.messages.splice(0, chat.messages.length, ...(chatMessages as any[]));
    editingUserMessageId.value = null;
    resetTransientState();
    scrollToBottom();
  } catch (error) {
    console.error('Failed to load thread messages:', error);
  }
};

// Select a thread
const selectThread = async (threadId: string) => {
  try {
    if (currentThread.value?.id === threadId) {
      return;
    }

    await stopActiveStreamIfNeeded('switch-thread', threadId);

    const thread = await window.electronAPI.chat.threads.get(threadId);
    if (!thread) {
      console.error('Thread not found:', threadId);
      return;
    }

    currentThread.value = thread;
    showWelcome.value = false;
    await loadThreadMessages(threadId);

    // Update sidebar current thread
    if (sidebarRef.value?.setCurrentThread) {
      sidebarRef.value.setCurrentThread(threadId);
    }
  } catch (error) {
    console.error('Failed to select thread:', error);
  }
};

const handleThreadDeleted = async (threadId: string) => {
  if (currentThread.value?.id !== threadId) return;

  await stopActiveStreamIfNeeded('delete-thread');
  currentThread.value = null;
  currentModel.value = '';
  chat.messages.splice(0, chat.messages.length);
  persistedMessageIds.clear();
  editingUserMessageId.value = null;
  resetTransientState();
  showWelcome.value = true;

  if (sidebarRef.value?.setCurrentThread) {
    sidebarRef.value.setCurrentThread(null);
  }
};

// Refresh threads list
const refreshThreads = async () => {
  if (sidebarRef.value?.refresh) {
    await sidebarRef.value.refresh();
  }
};

const updateThreadTitle = async (title: string) => {
  if (!currentThread.value) return;
  if (currentThread.value.title === title) return;

  try {
    await window.electronAPI.chat.threads.update(currentThread.value.id, { title });
    if (currentThread.value) {
      currentThread.value.title = title;
    }
    // Refresh sidebar to show updated title
    await refreshThreads();
  } catch (error) {
    console.error('Failed to update thread title:', error);
  }
};

const updateThreadTitleById = async (threadId: string, title: string) => {
  if (!threadId || !title.trim()) return;

  if (currentThread.value?.id === threadId) {
    await updateThreadTitle(title);
    return;
  }

  try {
    await window.electronAPI.chat.threads.update(threadId, { title });
    await refreshThreads();
  } catch (error) {
    console.error('Failed to update thread title by id:', error);
  }
};

const getConversationContentForTitle = (messages: UIMessage[]): string => {
  const lines: string[] = [];

  for (const message of messages) {
    const text = extractTextFromMessage(message).trim();
    if (!text) continue;

    const role =
      message.role === 'assistant' ? 'Assistant' : message.role === 'system' ? 'System' : 'User';
    lines.push(`${role}: ${text}`);
  }

  return lines.join('\n');
};

const getFallbackThreadTitle = (messages: UIMessage[]): string | null => {
  const latestUserText = [...messages]
    .reverse()
    .filter(message => message.role === 'user')
    .map(message => extractTextFromMessage(message).trim())
    .find(text => text.length > 0);
  const fallbackText = latestUserText || extractTextFromMessage(messages[0]).trim();
  if (!fallbackText) return null;
  return fallbackText.slice(0, 50) + (fallbackText.length > 50 ? '...' : '');
};

const shouldRegenerateThreadTitle = (messages: UIMessage[], currentTitle: string): boolean => {
  const assistantMessageCount = messages.filter(message => message.role === 'assistant').length;
  if (assistantMessageCount === 0) return false;
  if (currentTitle === 'New Chat') return true;
  return assistantMessageCount % TITLE_REGEN_INTERVAL === 0;
};

// Generate thread title using full conversation context
const generateThreadTitle = async (messages: UIMessage[]): Promise<string | null> => {
  try {
    const conversationContent = getConversationContentForTitle(messages);
    if (!conversationContent.trim()) {
      return getFallbackThreadTitle(messages);
    }

    const title = await window.electronAPI.toolModel.generateTitle(conversationContent);
    return title || getFallbackThreadTitle(messages);
  } catch (error) {
    console.error('Failed to generate thread title with agent:', error);
    return getFallbackThreadTitle(messages);
  }
};

const handleNewChat = async () => {
  await stopActiveStreamIfNeeded('new-chat');
  await createNewThread(currentModel.value);
};

const handleModelSelected = (data: { provider: any; model: string }) => {
  currentModel.value = data.model;
  // Update thread model if thread exists
  if (currentThread.value) {
    window.electronAPI.chat.threads.update(currentThread.value.id, { model: data.model });
  }
};

const handleMessageSent = async (
  content: string,
  model?: string,
  tools?: string[],
  onReady?: () => void
) => {
  try {
    const pendingEditMessageId = editingUserMessageId.value;

    // Create thread if it doesn't exist
    if (!currentThread.value) {
      const thread = await createNewThread(model || currentModel.value);
      if (!thread) {
        console.error('Failed to create thread');
        return;
      }
    }

    if (!currentThread.value) {
      console.error('No thread available');
      return;
    }

    // Update thread model if provided
    if (model && currentThread.value.model !== model) {
      await window.electronAPI.chat.threads.update(currentThread.value.id, { model });
      currentThread.value.model = model;
      currentModel.value = model;
    }

    // Store selected tools
    if (tools) {
      selectedTools.value = tools;
    }

    showWelcome.value = false;

    if (pendingEditMessageId && currentThread.value) {
      await stopActiveStreamIfNeeded('edit-resend');

      const messageIndex = chat.messages.findIndex(
        (message: any) => message && message.id === pendingEditMessageId
      );

      if (messageIndex >= 0) {
        const currentUserMessage = chat.messages[messageIndex] as UIMessage;
        const updatedUserMessage: UIMessage = {
          ...currentUserMessage,
          parts: upsertTextIntoMessageParts(currentUserMessage.parts, content),
        };

        chat.messages.splice(messageIndex, 1, updatedUserMessage as any);
        await upsertUiMessage(updatedUserMessage, undefined, 'user-message-edit', currentThread.value.id);
        await truncateConversationAfterIndex(messageIndex);

        activeAssistantParentId.value = updatedUserMessage.id;
        activeAssistantMessageId.value = null;
        activeStreamThreadId.value = currentThread.value.id;
        streamingAssistantText.value = '';
        streamRenderTraceId.value = `view-${Date.now()}`;
        streamRenderChunkCount.value = 0;
        streamRenderChars.value = 0;

        editingUserMessageId.value = null;
        scrollToBottom();
        return;
      }

      editingUserMessageId.value = null;
    }

    const userMessage: UIMessage = {
      id: createMessageId(),
      role: 'user',
      parts: [{ type: 'text', text: content, state: 'done' }],
    };

    chat.messages.push(userMessage as any);
    activeAssistantParentId.value = userMessage.id;
    activeAssistantMessageId.value = null;
    activeStreamThreadId.value = currentThread.value.id;
    const threadId = currentThread.value.id;
    streamingAssistantText.value = '';
    streamRenderTraceId.value = `view-${Date.now()}`;
    streamRenderChunkCount.value = 0;
    streamRenderChars.value = 0;
      await upsertUiMessage(userMessage, undefined, 'user-message', threadId);

      scrollToBottom();
  } finally {
    onReady?.();
  }
};

const handleStreamChunk = (chunk: string) => {
  if (!isStreamBoundToCurrentThread()) return;

  streamRenderTick.value += 1;
  streamingAssistantText.value += chunk;
  if (!streamRenderTraceId.value) {
    streamRenderTraceId.value = `view-${Date.now()}`;
  }
  streamRenderChunkCount.value += 1;
  streamRenderChars.value += chunk.length;
  if (shouldLogStreamChunk(streamRenderChunkCount.value)) {
    console.log(
      `[StreamDebug][Renderer][ChatView][${streamRenderTraceId.value}] handleStreamChunk#${streamRenderChunkCount.value} len=${chunk.length} totalChars=${streamRenderChars.value}`
    );
  }
  const assistantMessage = getOrCreateAssistantMessage();
  const messageIndex = chat.messages.findIndex((message: any) => message.id === assistantMessage.id);
  if (messageIndex < 0) return;

  const currentMessage = chat.messages[messageIndex] as UIMessage;
  const nextParts = [...currentMessage.parts];
  const lastPart = nextParts[nextParts.length - 1];
  const shouldAppendToLastStreamingText =
    isObjectRecord(lastPart) && lastPart.type === 'text' && lastPart.state === 'streaming';

  if (shouldAppendToLastStreamingText) {
    const textPartIndex = nextParts.length - 1;
    const textPart = nextParts[textPartIndex] as Record<string, unknown>;
    const previousText = typeof textPart.text === 'string' ? textPart.text : '';
    nextParts[textPartIndex] = {
      ...textPart,
      text: `${previousText}${chunk}`,
      state: 'streaming',
    } as any;
  } else {
    nextParts.push({
      type: 'text',
      text: chunk,
      state: 'streaming',
    } as any);
  }

  chat.messages.splice(
    messageIndex,
    1,
    {
      ...currentMessage,
      parts: nextParts,
    } as any
  );

  scrollToBottom();
};

const handleResponseReceived = async (fullText: string) => {
  if (!isStreamBoundToCurrentThread()) return;

  streamRenderTick.value += 1;
  if (!currentThread.value) return;
  const responseThreadId = activeStreamThreadId.value || currentThread.value.id;

  const assistantMessageId = activeAssistantMessageId.value;
  const existingAssistantMessage = getAssistantMessageById(assistantMessageId);
  if (!existingAssistantMessage && !fullText.trim()) {
    resetTransientState();
    return;
  }

  const baseAssistantMessage = existingAssistantMessage || getOrCreateAssistantMessage();
  const messageIndex = chat.messages.findIndex((message: any) => message.id === baseAssistantMessage.id);
  if (messageIndex < 0) {
    resetTransientState();
    return;
  }

  const currentAssistantMessage = chat.messages[messageIndex] as UIMessage;
  const nextParts = [...currentAssistantMessage.parts];
  const textPartIndices = nextParts
    .map((part, index) => ({ part, index }))
    .filter(({ part }) => isObjectRecord(part) && part.type === 'text')
    .map(({ index }) => index);
  const existingTextPart =
    textPartIndices.length > 0
      ? (nextParts[textPartIndices[textPartIndices.length - 1]] as Record<string, unknown>)
      : undefined;
  const streamedText =
    existingTextPart && typeof existingTextPart.text === 'string' ? existingTextPart.text : '';
  const finalText =
    fullText.length > 0
      ? fullText
      : streamingAssistantText.value || streamedText;
  let hasStreamingTextPart = false;

  for (const index of textPartIndices) {
    const part = nextParts[index] as Record<string, unknown>;
    if (part.state === 'streaming') {
      hasStreamingTextPart = true;
      nextParts[index] = {
        ...part,
        type: 'text',
        state: 'done',
      } as any;
    }
  }

  if (textPartIndices.length === 0 && finalText) {
    nextParts.push({
      type: 'text',
      text: finalText,
      state: 'done',
    } as any);
  } else if (!hasStreamingTextPart && finalText && !streamedText) {
    nextParts.push({
      type: 'text',
      text: finalText,
      state: 'done',
    } as any);
  }

  const assistantMessage: UIMessage = {
    ...currentAssistantMessage,
    parts: nextParts,
  };

  const hasRenderableContent = assistantMessage.parts.some(part => {
    if (isObjectRecord(part) && part.type === 'text') {
      return typeof part.text === 'string' && part.text.trim().length > 0;
    }
    return true;
  });

  if (!hasRenderableContent) {
    const messageIndex = chat.messages.findIndex((message: any) => message.id === assistantMessage.id);
    if (messageIndex >= 0) {
      chat.messages.splice(messageIndex, 1);
    }
    resetTransientState();
    scrollToBottom();
    return;
  }

  chat.messages.splice(messageIndex, 1, assistantMessage as any);
  const messagesSnapshotForTitle = [...(chat.messages as UIMessage[])];
  console.log(
    `[StreamDebug][Renderer][ChatView][${streamRenderTraceId.value || 'unknown'}] handleResponseReceived fullTextLen=${(fullText || '').length} chunkCount=${streamRenderChunkCount.value} chunkChars=${streamRenderChars.value}`
  );

  await upsertUiMessage(
    assistantMessage,
    activeAssistantParentId.value || undefined,
    'assistant-response',
    responseThreadId
  );

  if (currentThread.value?.id !== responseThreadId) {
    return;
  }

  // Regenerate title from full conversation context on interval
  if (
    messagesSnapshotForTitle.length > 0 &&
    shouldRegenerateThreadTitle(messagesSnapshotForTitle, currentThread.value.title)
  ) {
    const generatedTitle = await generateThreadTitle(messagesSnapshotForTitle);
    if (generatedTitle) {
      await updateThreadTitleById(responseThreadId, generatedTitle);
    }
  }

  resetTransientState();
  streamRenderTraceId.value = '';
  streamRenderChunkCount.value = 0;
  streamRenderChars.value = 0;
  scrollToBottom();
};

const handleToolUiChunk = async (chunk: UIMessageChunk) => {
  if (
    chunk.type !== 'tool-input-start' &&
    chunk.type !== 'tool-input-delta' &&
    chunk.type !== 'tool-input-available' &&
    chunk.type !== 'tool-input-error' &&
    chunk.type !== 'tool-output-available' &&
    chunk.type !== 'tool-output-error' &&
    chunk.type !== 'tool-output-denied' &&
    chunk.type !== 'tool-approval-request'
  ) {
    return;
  }

  if (chunk.type === 'tool-approval-request') {
    const existingAssistantMessage = getAssistantMessageById(activeAssistantMessageId.value);
    const existingPart = existingAssistantMessage?.parts.find(
      part => getToolCallIdFromPart(part) === chunk.toolCallId
    );
    const existingToolName =
      isObjectRecord(existingPart) && typeof existingPart.toolName === 'string'
        ? existingPart.toolName
        : 'tool';
    const existingInput =
      isObjectRecord(existingPart) && existingPart.input !== undefined ? existingPart.input : {};

    await handleToolApprovalRequest({
      approvalId: chunk.approvalId,
      toolCallId: chunk.toolCallId,
      toolCall: {
        toolName: existingToolName,
        toolCallId: chunk.toolCallId,
        args: existingInput,
      },
    });
    return;
  }

  const assistantMessage = getOrCreateAssistantMessage();
  const messageIndex = chat.messages.findIndex((message: any) => message.id === assistantMessage.id);
  if (messageIndex < 0) return;

  const currentAssistantMessage = chat.messages[messageIndex] as UIMessage;
  const nextParts = [...currentAssistantMessage.parts];
  for (let i = 0; i < nextParts.length; i += 1) {
    const part = nextParts[i];
    if (!isObjectRecord(part) || part.type !== 'text' || part.state !== 'streaming') continue;
    nextParts[i] = {
      ...part,
      state: 'done',
    } as any;
  }

  const toolCallId = chunk.toolCallId;
  const existingPartIndex = nextParts.findIndex(part => getToolCallIdFromPart(part) === toolCallId);
  const existingPart =
    existingPartIndex >= 0 && isObjectRecord(nextParts[existingPartIndex])
      ? (nextParts[existingPartIndex] as MessagePartRecord)
      : undefined;
  const chunkToolName =
    'toolName' in chunk && typeof chunk.toolName === 'string' && chunk.toolName.trim()
      ? chunk.toolName
      : undefined;

  const nextPart: MessagePartRecord = {
    ...(existingPart || {}),
    type: 'dynamic-tool',
    toolCallId,
    toolName:
      chunkToolName ||
      (existingPart && typeof existingPart.toolName === 'string' ? existingPart.toolName : 'tool'),
  };

  const nowMs = Date.now();
  if (typeof nextPart.startedAt !== 'number' || !Number.isFinite(nextPart.startedAt)) {
    nextPart.startedAt = nowMs;
  }

  if ('providerExecuted' in chunk && typeof chunk.providerExecuted === 'boolean') {
    nextPart.providerExecuted = chunk.providerExecuted;
  }
  if ('title' in chunk && typeof chunk.title === 'string') {
    nextPart.title = chunk.title;
  }

  if (chunk.type === 'tool-input-start') {
    nextPart.state = 'input-streaming';
    if (nextPart.input === undefined) {
      nextPart.input = {};
    }
  } else if (chunk.type === 'tool-input-delta') {
    const delta = typeof chunk.inputTextDelta === 'string' ? chunk.inputTextDelta : '';
    const previousInputText = typeof nextPart.inputText === 'string' ? nextPart.inputText : '';
    const inputText = `${previousInputText}${delta}`;
    nextPart.inputText = inputText;
    nextPart.input = parseToolInputFromText(inputText);
    nextPart.state = 'input-streaming';
  } else if (chunk.type === 'tool-input-available') {
    if (isObjectRecord(nextPart.input) && isObjectRecord(chunk.input)) {
      // Preserve any fields that may have been present in streamed JSON but stripped by tool schema validation.
      nextPart.input = { ...nextPart.input, ...chunk.input };
    } else {
      nextPart.input = chunk.input ?? nextPart.input ?? {};
    }
    nextPart.state = 'input-available';
    delete nextPart.inputText;
  } else if (chunk.type === 'tool-input-error') {
    if (isObjectRecord(nextPart.input) && isObjectRecord(chunk.input)) {
      nextPart.input = { ...nextPart.input, ...chunk.input };
    } else {
      nextPart.input = chunk.input ?? nextPart.input ?? {};
    }
    nextPart.output = {
      error: chunk.errorText || 'Invalid tool input',
    };
    nextPart.state = 'output-error';
    nextPart.endedAt = nowMs;
    nextPart.durationMs = Math.max(0, nowMs - (nextPart.startedAt as number));
    delete nextPart.inputText;
  } else if (chunk.type === 'tool-output-available') {
    nextPart.output = chunk.output;
    nextPart.state = chunk.preliminary ? 'input-streaming' : 'output-available';
    if (!chunk.preliminary) {
      nextPart.endedAt = nowMs;
      nextPart.durationMs = Math.max(0, nowMs - (nextPart.startedAt as number));
      if (typeof nextPart.collapsed !== 'boolean') {
        nextPart.collapsed = true;
      }
    }
    delete nextPart.inputText;
  } else if (chunk.type === 'tool-output-error') {
    nextPart.output = {
      error: chunk.errorText || 'Tool execution failed',
    };
    nextPart.state = 'output-error';
    nextPart.endedAt = nowMs;
    nextPart.durationMs = Math.max(0, nowMs - (nextPart.startedAt as number));
    delete nextPart.inputText;
  } else if (chunk.type === 'tool-output-denied') {
    nextPart.state = 'output-denied';
    nextPart.output = {
      message: 'Tool execution denied',
      toolCallId,
    };
    nextPart.endedAt = nowMs;
    nextPart.durationMs = Math.max(0, nowMs - (nextPart.startedAt as number));
    delete nextPart.inputText;
  }

  if (existingPartIndex >= 0) {
    nextParts[existingPartIndex] = nextPart as any;
  } else {
    nextParts.push(nextPart as any);
  }

  const updatedMessage: UIMessage = {
    ...currentAssistantMessage,
    parts: nextParts,
  };

  chat.messages.splice(messageIndex, 1, updatedMessage as any);

  if (
    chunk.type === 'tool-input-available' ||
    chunk.type === 'tool-input-error' ||
    chunk.type === 'tool-output-available' ||
    chunk.type === 'tool-output-error' ||
    chunk.type === 'tool-output-denied'
  ) {
    const streamThreadId = activeStreamThreadId.value || currentThread.value?.id;
    await upsertUiMessage(
      updatedMessage,
      activeAssistantParentId.value || undefined,
      `tool-ui-chunk:${chunk.type}`,
      streamThreadId
    );
  }

  scrollToBottom();
};

const handleUiChunk = async (chunk: unknown) => {
  if (!isStreamBoundToCurrentThread()) return;
  if (!isObjectRecord(chunk) || typeof chunk.type !== 'string') return;

  if (chunk.type === 'text-delta') {
    const delta = typeof chunk.delta === 'string' ? chunk.delta : '';
    if (!delta) return;
    handleStreamChunk(delta);
    return;
  }

  if (chunk.type === 'finish' || chunk.type === 'abort') {
    await handleResponseReceived(streamingAssistantText.value);
    return;
  }

  if (chunk.type === 'error') {
    const errorText =
      typeof chunk.errorText === 'string' && chunk.errorText.trim().length > 0
        ? chunk.errorText
        : 'Unknown chat stream error';
    console.error('[ChatView] UI stream error:', errorText);
    if (streamingAssistantText.value.trim().length > 0) {
      await handleResponseReceived(streamingAssistantText.value);
    } else {
      resetTransientState();
    }
    return;
  }

  await handleToolUiChunk(chunk as UIMessageChunk);
};

const handleToolApprovalRequest = async (request: any) => {
  if (!isStreamBoundToCurrentThread()) return;
  const streamThreadId = activeStreamThreadId.value || currentThread.value?.id;
  const assistantMessage = getOrCreateAssistantMessage();
  const requestedToolCallId = request.toolCallId || request.toolCall?.toolCallId;
  const existingPartIndex = assistantMessage.parts.findIndex(part => {
    if (getApprovalId(part) === request.approvalId) return true;
    if (!requestedToolCallId) return false;
    return getToolCallIdFromPart(part) === requestedToolCallId;
  });

  const existingPart =
    existingPartIndex >= 0 && isObjectRecord(assistantMessage.parts[existingPartIndex])
      ? (assistantMessage.parts[existingPartIndex] as MessagePartRecord)
      : undefined;

  const approvalPart: MessagePartRecord = {
    ...(existingPart || {}),
    type: 'dynamic-tool',
    toolName: request.toolCall?.toolName || existingPart?.toolName || 'tool',
    toolCallId: requestedToolCallId || getToolCallIdFromPart(existingPart) || createMessageId(),
    input: request.toolCall?.args ?? existingPart?.input ?? {},
    state: 'approval-requested',
    approval: {
      id: request.approvalId,
    },
  };

  if (typeof approvalPart.startedAt !== 'number' || !Number.isFinite(approvalPart.startedAt)) {
    approvalPart.startedAt = Date.now();
  }
  delete approvalPart.endedAt;
  delete approvalPart.durationMs;

  if (existingPartIndex >= 0) {
    assistantMessage.parts.splice(existingPartIndex, 1, approvalPart as any);
  } else {
    assistantMessage.parts.push(approvalPart as any);
  }

  const assistantMessageToPersist =
    existingPartIndex >= 0
      ? ({
          ...assistantMessage,
          parts: [...assistantMessage.parts],
        } as UIMessage)
      : assistantMessage;
  await upsertUiMessage(
    assistantMessageToPersist,
    activeAssistantParentId.value || undefined,
    'tool-approval-request',
    streamThreadId
  );
  scrollToBottom();
};

const handleToolApproval = async (message: UIMessage, part: any, approved: boolean) => {
  const approvalId = getApprovalId(part);
  if (!approvalId) return;

  // After a reload, transient streaming state is empty, so UI chunks from a resumed approval would be ignored.
  // Re-bind the stream to the current thread + assistant message so resume works reliably.
  if (currentThread.value?.id) {
    activeStreamThreadId.value = currentThread.value.id;
  }
  if (message?.id) {
    activeAssistantMessageId.value = message.id;
  }
  if (!activeAssistantParentId.value && message?.id) {
    const messageIndex = chat.messages.findIndex((m: any) => m && m.id === message.id);
    if (messageIndex >= 0) {
      const parent = [...chat.messages.slice(0, messageIndex)]
        .reverse()
        .find((m: any) => m && m.role === 'user' && typeof m.id === 'string');
      if (parent?.id) {
        activeAssistantParentId.value = parent.id;
      }
    }
  }
  streamingAssistantText.value = '';
  streamRenderTraceId.value = `approval-${Date.now()}`;
  streamRenderChunkCount.value = 0;
  streamRenderChars.value = 0;

  approvalProcessing.value[approvalId] = true;

  try {
    const result = await window.electronAPI.chat.approveTool(approvalId, approved);
    if (!result?.success) {
      throw new Error(result?.error || 'Tool approval failed');
    }

    if (approved) {
      part.state = 'approval-responded';
      part.approval = {
        id: approvalId,
        approved: true,
        reason: 'User approved tool execution.',
      };
    } else {
      const nowMs = Date.now();
      if (typeof part.startedAt !== 'number' || !Number.isFinite(part.startedAt)) {
        part.startedAt = nowMs;
      }
      part.endedAt = nowMs;
      part.durationMs = Math.max(0, nowMs - (part.startedAt as number));
      part.state = 'output-denied';
      part.approval = {
        id: approvalId,
        approved: false,
        reason: 'User rejected tool execution.',
      };
    }

    await upsertUiMessage(
      message,
      activeAssistantParentId.value || undefined,
      approved ? 'tool-approval:approve' : 'tool-approval:reject'
    );
  } catch (error) {
    console.error('Failed to approve tool:', error);
  } finally {
    approvalProcessing.value[approvalId] = false;
  }
};

// Listen for model selection from ChatInput
onMounted(async () => {
  // Initialize config store if not already initialized
  if (!configStore.initialized) {
    await configStore.initialize();
  }
  // Load threads on mount
  await refreshThreads();

  window.electronAPI.chat.removeAllListeners();
  window.electronAPI.chat.onUiChunk((chunk: unknown) => {
    void handleUiChunk(chunk);
  });
});

onUnmounted(() => {
  window.electronAPI.chat.removeAllListeners();
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

.tool-usage-summary {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin-bottom: 8px;
}

.tool-usage-label {
  font-size: 11px;
  color: var(--text-muted);
  letter-spacing: 0.02em;
  text-transform: uppercase;
}

.tool-usage-pill {
  font-size: 11px;
  padding: 3px 8px;
  border-radius: 999px;
  border: 1px solid var(--border-color);
  background: var(--bg-tertiary);
  color: var(--text-secondary);
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
  transition: opacity 0.15s ease, transform 0.15s ease;
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
  transition: opacity 0.15s ease, transform 0.15s ease;
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
  background: color-mix(in srgb, var(--accent-color) 18%, var(--bg-tertiary));
  border: 1px solid color-mix(in srgb, var(--accent-color) 35%, var(--border-color));
  border-radius: 12px;
  padding: var(--chat-bubble-padding-y, 12px) var(--chat-bubble-padding-x, 16px);
  box-shadow: 0 8px 16px rgba(0, 0, 0, 0.08);
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
  transition: color 0.2s ease, border-color 0.2s ease;
}

.message-text.markdown-content :deep(a:hover) {
  color: var(--accent-hover);
  border-bottom-color: var(--accent-hover);
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
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono',
    'Courier New', monospace;
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
  transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease;
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
  transition: color 0.2s ease, border-color 0.2s ease;
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
