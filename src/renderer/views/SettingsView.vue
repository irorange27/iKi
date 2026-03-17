<template>
  <div class="settings-container">
    <div class="titlebar-drag-region"></div>
    <!-- Left Nav -->
    <aside class="settings-nav">
      <ul class="nav-menu">
        <li
          v-for="item in menuItems"
          :key="item.key"
          :class="{ active: activeSection === item.key }"
          @click="activeSection = item.key"
        >
          <span class="icon">
            <component :is="item.icon" :size="20" />
          </span>
          {{ item.label }}
        </li>
      </ul>
    </aside>

    <!-- Right Side Config Panel -->
    <main class="settings-content">
      <div class="settings-header">
        <div class="settings-header-left">
          <span class="icon"><component :is="activeSectionIcon" :size="22" /></span>
          <span class="title">{{ activeSectionLabel }}</span>
        </div>
        <div class="settings-header-right" :class="{ 'is-unsaved': !saved }">
          <span class="unsaved-dot" />
          <span>{{ saved ? 'All changes saved' : 'Unsaved changes' }}</span>
        </div>
      </div>
      <!-- General -->
      <section v-show="activeSection === 'general'" class="config-section">
        <div class="config-group">
          <h3>Tool Model</h3>
          <p class="group-description">
            The Tool Model is a dedicated model used for background AI operations, separate from
            your main chat model. This allows you to use a fast, cost-effective model for auxiliary
            tasks while using more capable models for conversation.
          </p>
          <div class="tool-model-selector">
            <label class="input-label">
              <div class="label-header">
                <span>Select Tool Model</span>
                <button
                  v-if="selectedToolModel"
                  class="test-model-btn"
                  @click="testToolModel"
                  :disabled="isTestingModel"
                >
                  <RefreshCw :size="14" :class="{ 'animate-spin': isTestingModel }" />
                  {{ isTestingModel ? 'Testing...' : 'Test' }}
                </button>
              </div>
              <select
                :value="config.toolModel.model"
                @change="updateToolModel('model', ($event.target as HTMLSelectElement).value)"
                class="tool-model-select"
              >
                <option value="">Auto-detect (Recommended)</option>
                <optgroup
                  v-for="provider in availableProvidersWithModels"
                  :key="provider.id"
                  :label="provider.name"
                >
                  <option v-for="model in provider.models" :key="model" :value="model">
                    {{ model }}
                  </option>
                </optgroup>
              </select>
            </label>
            <div v-if="toolModelTestResult" class="test-result" :class="toolModelTestResult.status">
              <span v-if="toolModelTestResult.status === 'success'">✅</span>
              <span v-else-if="toolModelTestResult.status === 'warning'">⚠️</span>
              <span v-else>❌</span>
              {{ toolModelTestResult.message }}
            </div>
            <div class="tool-model-info">
              <p class="info-text">
                <strong>Recommended models:</strong> gpt-4o-mini, claude-3-5-haiku,
                gemini-2.0-flash, deepseek-chat
              </p>
              <p class="info-text">
                <strong>What Tool Model does:</strong> Thread title generation, tool selection,
                parameter extraction, memory operations, and background tasks.
              </p>
              <p class="info-text warning-text">
                <strong>⚠️ Avoid reasoning models:</strong> Never use o1, o3, or extended thinking
                models as they are too slow for tool operations.
              </p>
            </div>
          </div>
        </div>

        <div class="config-group">
          <h3>Shell Tool Approval</h3>
          <p class="group-description">
            Configure when shell commands require manual approval before execution.
          </p>
          <label class="input-label">
            <span>Approval Mode</span>
            <select
              :value="config.toolExecution.shellApprovalMode"
              @change="
                updateToolExecution(
                  'shellApprovalMode',
                  ($event.target as HTMLSelectElement).value as AppConfig['toolExecution']['shellApprovalMode']
                )
              "
            >
              <option value="high-risk">Only High-risk Commands (Recommended)</option>
              <option value="always">Always Require Approval</option>
              <option value="never">Never Require Approval</option>
            </select>
          </label>
          <label class="input-label">
            <span>Custom High-risk Regex (one per line)</span>
            <textarea
              rows="5"
              :value="shellHighRiskPatternText"
              placeholder="Example: \\bgit\\s+push\\s+--force\\b"
              @input="updateShellHighRiskPatterns(($event.target as HTMLTextAreaElement).value)"
            />
          </label>
          <p class="group-description">
            Patterns here are matched in high-risk mode and force approval when matched.
          </p>
        </div>

        <div class="config-group">
          <h3>Language</h3>
          <label class="input-label">
            <select
              :value="config.general.language"
              @change="updateGeneral('language', ($event.target as HTMLSelectElement).value)"
            >
              <option value="en">English</option>
              <option value="zh-CN">简体中文</option>
            </select>
          </label>
        </div>

        <div class="config-group">
          <h3>Theme</h3>
          <div class="button-group">
            <button
              v-for="theme in themeOptions"
              :key="theme"
              :class="{ active: config.general.theme === theme }"
              @click="updateGeneral('theme', theme)"
            >
              {{ theme.charAt(0).toUpperCase() + theme.slice(1) }}
            </button>
          </div>
        </div>

        <div class="config-group">
          <h3>Startup Behavior</h3>
          <label
            v-for="key in ['startMinimized', 'minimizeToTray', 'closeToTray', 'autoUpdate']"
            :key="key"
            class="checkbox-label"
          >
            <input
              type="checkbox"
              :checked="config.general[key as keyof typeof config.general] as boolean"
              @change="updateGeneral(key as any, ($event.target as HTMLInputElement).checked)"
            />
            {{ formatLabel(key) }}
          </label>
        </div>

        <button class="reset-btn" @click="resetSection('general')">Reset General</button>
      </section>

      <ProvidersSettings v-show="activeSection === 'provider'" />

      <!-- UI -->
      <section v-show="activeSection === 'ui'" class="config-section">
        <div class="config-group">
          <h3>
            Font Size
            <span class="value-badge">{{ config.ui.fontSize }}px</span>
          </h3>
          <input
            type="range"
            min="10"
            max="32"
            :value="config.ui.fontSize"
            @input="setFontSize(parseInt(($event.target as HTMLInputElement).value))"
          />
        </div>

        <div class="config-group">
          <h3>
            Chat Content Padding
            <span class="value-badge">{{ config.ui.chatContentPadding }}px</span>
          </h3>
          <input
            type="range"
            min="8"
            max="40"
            :value="config.ui.chatContentPadding"
            @input="
              setUiMetric('chatContentPadding', parseInt(($event.target as HTMLInputElement).value))
            "
          />
        </div>

        <div class="config-group">
          <h3>
            Composer Padding
            <span class="value-badge">{{ config.ui.composerPadding }}px</span>
          </h3>
          <input
            type="range"
            min="4"
            max="24"
            :value="config.ui.composerPadding"
            @input="setUiMetric('composerPadding', parseInt(($event.target as HTMLInputElement).value))"
          />
        </div>

        <div class="config-group">
          <h3>
            Bubble Horizontal Padding
            <span class="value-badge">{{ config.ui.messageBubblePaddingX }}px</span>
          </h3>
          <input
            type="range"
            min="8"
            max="28"
            :value="config.ui.messageBubblePaddingX"
            @input="
              setUiMetric('messageBubblePaddingX', parseInt(($event.target as HTMLInputElement).value))
            "
          />
        </div>

        <div class="config-group">
          <h3>
            Bubble Vertical Padding
            <span class="value-badge">{{ config.ui.messageBubblePaddingY }}px</span>
          </h3>
          <input
            type="range"
            min="6"
            max="20"
            :value="config.ui.messageBubblePaddingY"
            @input="
              setUiMetric('messageBubblePaddingY', parseInt(($event.target as HTMLInputElement).value))
            "
          />
        </div>

        <div class="config-group">
          <h3>
            Message Gap
            <span class="value-badge">{{ config.ui.messageGap }}px</span>
          </h3>
          <input
            type="range"
            min="8"
            max="32"
            :value="config.ui.messageGap"
            @input="setUiMetric('messageGap', parseInt(($event.target as HTMLInputElement).value))"
          />
        </div>

        <div class="config-group">
          <h3>Interface Density</h3>
          <div class="density-options">
            <div
              v-for="density in densityOptions"
              :key="density.key"
              class="density-card"
              :class="{ active: config.ui.density === density.key }"
              @click="setDensity(density.key)"
            >
              <div class="density-preview" :data-density="density.key"></div>
              <span>{{ density.label }}</span>
            </div>
          </div>
        </div>

        <button class="reset-btn" @click="resetSection('ui')">Reset UI</button>
      </section>

      <!-- Network -->
      <section v-show="activeSection === 'network'" class="config-section">
        <div class="config-group">
          <h3>Proxy</h3>
          <label class="checkbox-label">
            <input
              type="checkbox"
              :checked="config.network.proxy.enable"
              @change="updateNetwork('proxy.enable', ($event.target as HTMLInputElement).checked)"
            />
            Enable Proxy
          </label>

          <template v-if="config.network.proxy.enable">
            <label class="input-label"
              >Type
              <select
                :value="config.network.proxy.type"
                @change="updateNetwork('proxy.type', ($event.target as HTMLSelectElement).value)"
              >
                <option value="http">HTTP</option>
                <option value="https">HTTPS</option>
                <option value="socks5">SOCKS5</option>
              </select>
            </label>

            <label class="input-label"
              >Host
              <input
                type="text"
                :value="config.network.proxy.host"
                @input="updateNetwork('proxy.host', $event.target.value)"
              />
            </label>

            <label class="input-label"
              >Port
              <input
                type="number"
                :value="config.network.proxy.port || ''"
                @input="
                  updateNetwork(
                    'proxy.port',
                    $event.target.value ? parseInt($event.target.value) : null
                  )
                "
              />
            </label>
          </template>
        </div>

        <div class="config-group">
          <h3>Timeout & Retry</h3>
          <div class="slider-field">
            <span>Timeout (ms)</span>
            <span class="value-badge">{{ config.network.timeout }}</span>
          </div>
          <input
            type="range"
            min="1000"
            max="20000"
            step="500"
            :value="config.network.timeout"
            @input="updateNetwork('timeout', parseInt($event.target.value))"
          />
          <p class="slider-hint">Controls how long the app waits before timing out.</p>

          <div class="slider-field">
            <span>Retry Attempts</span>
            <span class="value-badge">{{ config.network.retryAttempts }}</span>
          </div>
          <input
            type="range"
            min="0"
            max="10"
            step="1"
            :value="config.network.retryAttempts"
            @input="updateNetwork('retryAttempts', parseInt($event.target.value))"
          />
          <p class="slider-hint">Number of retries before a request fails.</p>
        </div>

        <button class="reset-btn" @click="resetSection('network')">Reset Network</button>
      </section>

      <!-- Security -->
      <section v-show="activeSection === 'security'" class="config-section">
        <div class="config-group">
          <h3>Data Protection</h3>
          <label
            v-for="key in ['encryptApikeys', 'requirePassword'] as const"
            :key="key"
            class="checkbox-label"
          >
            <input
              type="checkbox"
              :checked="config.security[key]"
              @change="updateSecurity(key, ($event.target as HTMLInputElement).checked)"
            />
            {{ formatLabel(key) }}
          </label>
        </div>

        <div class="config-group">
          <h3>Session Timeout</h3>
          <div class="slider-field">
            <span>Minutes</span>
            <span class="value-badge">{{ config.security.sessionTimeout }}</span>
          </div>
          <input
            type="range"
            min="5"
            max="240"
            step="5"
            :value="config.security.sessionTimeout"
            @input="updateSecurity('sessionTimeout', parseInt($event.target.value))"
          />
          <p class="slider-hint">Shorter timeouts increase security.</p>
        </div>

        <div class="config-group">
          <h3>Logging</h3>
          <label class="checkbox-label">
            <input
              type="checkbox"
              :checked="config.security.enableLogging"
              @change="updateSecurity('enableLogging', $event.target.checked)"
            />
            Enable Logging
          </label>
          <label v-if="config.security.enableLogging" class="input-label"
            >Level:
            <select
              :value="config.security.logLevel"
              @change="updateSecurity('logLevel', $event.target.value)"
            >
              <option value="error">Error</option>
              <option value="warn">Warning</option>
              <option value="info">Info</option>
              <option value="debug">Debug</option>
            </select>
          </label>
        </div>

        <button class="reset-btn" @click="resetSection('security')">Reset Security</button>
      </section>

      <!-- Advanced -->
      <section v-show="activeSection === 'advanced'" class="config-section">
        <div class="config-group">
          <h3>Development Mode</h3>
          <label
            v-for="key in ['debugMode', 'developerMode', 'enableExperimentalFeatures'] as const"
            :key="key"
            class="checkbox-label"
          >
            <input
              type="checkbox"
              :checked="config.advanced[key]"
              @change="updateAdvanced(key, ($event.target as HTMLInputElement).checked)"
            />
            {{ formatLabel(key) }}
          </label>
        </div>

        <button class="reset-btn" @click="resetSection('advanced')">Reset Advanced</button>
      </section>

      <!-- Keybindings -->
      <section v-show="activeSection === 'keybindings'" class="config-section">
        <div class="config-group">
          <label v-for="(value, key) in config.keybindings" :key="key" class="input-label">
            {{ formatLabel(key) }}:
            <input type="text" :value="value" @input="updateKeybinding(key, $event.target.value)" />
          </label>
        </div>

        <button class="reset-btn" @click="resetSection('keybindings')">Reset Keybindings</button>
      </section>

      <!-- Memory -->
      <section v-show="activeSection === 'memory'" class="config-section">
        <div class="settings-card">
          <div class="card-title">Memory Retrieval</div>
          <label class="checkbox-label">
            <input
              type="checkbox"
              :checked="config.memory.enabled"
              @change="updateMemory('enabled', $event.target.checked)"
            />
            Enable Memory
          </label>
          <p class="card-help">
            Long-term memory is injected automatically when Memory is enabled.
          </p>

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
              @input="updateMemory('maxRetrievalCount', parseInt($event.target.value))"
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
              @input="updateMemory('similarThreshold', parseInt($event.target.value) / 100)"
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
            Automatically extract and store important information from conversations as new
            memories.
          </p>
        </div>

        <div class="settings-card memory-viewer">
          <div class="card-title">Memory Viewer</div>
          <p class="card-help">
            View short-term and long-term memory entries by chat thread, plus long-memory search
            results.
          </p>
          <div class="memory-controls">
            <label class="input-label">
              <span>Thread</span>
              <select
                :value="selectedMemoryThreadId"
                @change="selectMemoryThread(($event.target as HTMLSelectElement).value)"
              >
                <option value="" disabled>Select a thread</option>
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
                  <div class="memory-item-content">{{ entry.summary }}</div>
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

        <button class="reset-btn" @click="resetSection('memory')">Reset Memory</button>
      </section>

      <!-- Tasks -->
      <section v-show="activeSection === 'tasks'" class="config-section">
        <div class="settings-card">
          <div class="card-title">Proactive Tasks</div>
          <p class="card-help">
            Create scheduled tasks that run in the background and push results into a chat thread.
          </p>

          <label class="input-label">
            <span>Name</span>
            <input v-model="taskForm.name" type="text" placeholder="Daily briefing" />
          </label>

          <label class="input-label">
            <span>Prompt</span>
            <textarea
              v-model="taskForm.prompt"
              placeholder="What should this task do?"
            />
          </label>

          <div class="task-form-grid">
            <label class="input-label">
              <span>Every (minutes)</span>
              <input
                v-model.number="taskForm.interval_minutes"
                type="number"
                min="1"
                max="10080"
              />
            </label>

            <label class="input-label">
              <span>Provider</span>
              <select v-model="taskForm.provider_type">
                <option
                  v-for="provider in uniqueProviderTypes"
                  :key="provider.type"
                  :value="provider.type"
                >
                  {{ provider.name }}
                </option>
              </select>
            </label>
          </div>

          <label class="input-label">
            <span>Model</span>
            <select v-model="taskForm.model">
              <option v-for="model in taskAvailableModels" :key="model" :value="model">
                {{ model }}
              </option>
            </select>
          </label>

          <label class="input-label">
            <span>Push To Thread</span>
            <select v-model="taskForm.thread_id">
              <option value="">Auto-create dedicated thread</option>
              <option v-for="thread in taskThreads" :key="thread.id" :value="thread.id">
                {{ thread.title || thread.id }}
              </option>
            </select>
          </label>

          <div class="task-tools">
            <div class="task-tools-title">Allowed Tools (safe)</div>
            <div class="task-tools-grid">
              <label v-for="tool in SAFE_TASK_TOOLS" :key="tool" class="checkbox-label">
                <input
                  type="checkbox"
                  :checked="taskForm.tools.includes(tool)"
                  @change="
                    toggleTaskTool(
                      tool,
                      ($event.target as HTMLInputElement).checked
                    )
                  "
                />
                {{ tool }}
              </label>
            </div>
          </div>

          <label class="checkbox-label">
            <input type="checkbox" v-model="taskForm.enabled" />
            Enabled
          </label>

          <label class="checkbox-label">
            <input type="checkbox" v-model="taskForm.notify" />
            Desktop notification
          </label>

          <div class="task-form-actions">
            <button
              class="secondary-btn"
              @click="createProactiveTask"
              :disabled="taskCreateLoading"
            >
              {{ taskCreateLoading ? 'Creating...' : 'Create Task' }}
            </button>
            <button class="secondary-btn" @click="refreshTasks" :disabled="tasksLoading">
              Refresh
            </button>
          </div>

          <p v-if="taskCreateError" class="tasks-error">{{ taskCreateError }}</p>
          <p v-if="tasksError" class="tasks-error">{{ tasksError }}</p>
        </div>

        <div class="settings-card">
          <div class="card-title">Existing Tasks</div>

          <div v-if="tasksLoading" class="tasks-empty">Loading...</div>
          <div v-else-if="proactiveTasks.length === 0" class="tasks-empty">No tasks yet.</div>
          <div v-else class="tasks-list">
            <div v-for="task in proactiveTasks" :key="task.id" class="task-item">
              <div class="task-item-header">
                <div class="task-item-title">
                  <span class="task-name">{{ task.name }}</span>
                  <span class="task-status" :class="`status-${task.last_status || 'idle'}`">
                    {{ task.last_status || 'idle' }}
                  </span>
                </div>
                <div class="task-item-actions">
                  <button
                    class="skills-mini-btn"
                    @click="runTaskNow(task)"
                    :disabled="!!taskRunLoading[task.id]"
                  >
                    {{ taskRunLoading[task.id] ? 'Running...' : 'Run now' }}
                  </button>
                  <button class="skills-mini-btn" @click="deleteTask(task)">Delete</button>
                </div>
              </div>

              <div class="task-item-meta">
                <label class="checkbox-label task-compact-check">
                  <input
                    type="checkbox"
                    :checked="task.enabled"
                    @change="toggleTaskEnabled(task, ($event.target as HTMLInputElement).checked)"
                  />
                  Enabled
                </label>
                <label class="checkbox-label task-compact-check">
                  <input
                    type="checkbox"
                    :checked="task.notify"
                    @change="toggleTaskNotify(task, ($event.target as HTMLInputElement).checked)"
                  />
                  Notify
                </label>

                <label class="input-label task-inline-field">
                  <span>Every (min)</span>
                  <input
                    type="number"
                    min="1"
                    max="10080"
                    :value="task.interval_minutes"
                    @change="updateTaskInterval(task, ($event.target as HTMLInputElement).value)"
                  />
                </label>
              </div>

              <div class="task-item-times">
                <div>
                  <span class="task-meta-label">Next:</span>
                  {{ task.next_run_at ? formatTimestamp(task.next_run_at) : '-' }}
                </div>
                <div>
                  <span class="task-meta-label">Last:</span>
                  {{ task.last_run_at ? formatTimestamp(task.last_run_at) : '-' }}
                </div>
              </div>

              <div v-if="task.last_error" class="tasks-error task-error-block">
                {{ task.last_error }}
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- Skills -->
      <section v-show="activeSection === 'skills'" class="config-section">
        <div class="settings-card">
          <div class="skills-toolbar">
            <div class="skills-toolbar-left">
              <div class="card-title">Skills</div>
              <div class="skills-subtitle">
                {{ filteredSkills.length }} skill(s) available
              </div>
            </div>
            <div class="skills-toolbar-actions">
              <button class="secondary-btn skills-btn" @click="refreshSkills" :disabled="skillsLoading">
                <RefreshCw :size="14" :class="{ 'animate-spin': skillsLoading }" />
                {{ skillsLoading ? 'Refreshing...' : 'Refresh' }}
              </button>
              <button class="secondary-btn skills-btn" @click="openSkillsFolder">
                Open Folder
              </button>
            </div>
          </div>

          <p class="card-help">
            Skills are instruction packs loaded from local <code>SKILL.md</code> files. Put your custom
            skills into the Personal skills folder to make them show up here.
          </p>

          <div class="skills-paths" v-if="skillRoots.length">
            <div
              v-for="root in skillRoots"
              :key="root.source"
              class="skills-path-row"
            >
              <span class="skills-path-label">{{ root.source === 'user' ? 'Personal' : 'Codex' }}</span>
              <code class="skills-path-value">{{ root.path }}</code>
              <button class="skills-mini-btn" @click="openSkillsFolder(root.source)">
                Open
              </button>
            </div>
          </div>

          <div class="skills-search">
            <input
              type="text"
              v-model="skillSearchQuery"
              placeholder="Search skills by name, description, or id..."
            />
          </div>

          <p v-if="skillsError" class="skills-error">{{ skillsError }}</p>

          <div v-if="!skillsLoading && filteredSkills.length === 0" class="skills-empty">
            No skills found.
          </div>

          <div class="skills-groups" v-else>
            <div v-if="personalSkills.length" class="skills-group">
              <div class="skills-group-title">
                Personal Skills <span class="skills-count-pill">{{ personalSkills.length }}</span>
              </div>
              <div class="skills-list">
                <div v-for="skill in personalSkills" :key="skill.id" class="skill-item">
                  <div class="skill-item-header">
                    <div class="skill-item-meta">
                      <div class="skill-name">{{ skill.name }}</div>
                      <div class="skill-desc">{{ skill.description || 'No description' }}</div>
                      <div class="skill-id">{{ skill.path || skill.id }}</div>
                    </div>
                    <div class="skill-item-actions">
                      <button class="skills-mini-btn" @click="openSkillFolder(skill.id)">Open</button>
                      <button class="skills-mini-btn" @click="toggleSkillContent(skill.id)">
                        {{ isSkillExpanded(skill.id) ? 'Hide' : 'View Content' }}
                      </button>
                    </div>
                  </div>
                  <div v-if="isSkillExpanded(skill.id)" class="skill-content">
                    <div v-if="skillContentLoading[skill.id]" class="skills-empty">Loading...</div>
                    <pre v-else class="skill-content-pre">{{ skillContents[skill.id] || '' }}</pre>
                    <div v-if="skillContentTruncated[skill.id]" class="skills-truncated">
                      Content truncated for display.
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div v-if="codexSkills.length" class="skills-group">
              <div class="skills-group-title">
                Codex Skills <span class="skills-count-pill">{{ codexSkills.length }}</span>
              </div>
              <div class="skills-list">
                <div v-for="skill in codexSkills" :key="skill.id" class="skill-item">
                  <div class="skill-item-header">
                    <div class="skill-item-meta">
                      <div class="skill-name">{{ skill.name }}</div>
                      <div class="skill-desc">{{ skill.description || 'No description' }}</div>
                      <div class="skill-id">{{ skill.path || skill.id }}</div>
                    </div>
                    <div class="skill-item-actions">
                      <button class="skills-mini-btn" @click="openSkillFolder(skill.id)">Open</button>
                      <button class="skills-mini-btn" @click="toggleSkillContent(skill.id)">
                        {{ isSkillExpanded(skill.id) ? 'Hide' : 'View Content' }}
                      </button>
                    </div>
                  </div>
                  <div v-if="isSkillExpanded(skill.id)" class="skill-content">
                    <div v-if="skillContentLoading[skill.id]" class="skills-empty">Loading...</div>
                    <pre v-else class="skill-content-pre">{{ skillContents[skill.id] || '' }}</pre>
                    <div v-if="skillContentTruncated[skill.id]" class="skills-truncated">
                      Content truncated for display.
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- Footer operabar -->
      <div class="settings-footer">
        <span v-if="saved" class="save-status">All changes saved</span>
        <div class="footer-actions">
          <button class="secondary" @click="$emit('close')">Close</button>
          <button class="primary" @click="saveAndClose">Save</button>
        </div>
      </div>
    </main>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, watch } from 'vue';
import { storeToRefs } from 'pinia';
import {
  Cog,
  Palette,
  Brain,
  Bot,
  RefreshCw,
  AlarmClock,
  Wand2,
} from 'lucide-vue-next';

import ProvidersSettings from '../components/settings/ProvidersSettings.vue';
import { useConfigStore } from '../store/config';
import type { AppConfig } from '../../shared/types/config';
import type { ChatThread } from '../../shared/types/chat';
import type {
  ShortMemoryEntry,
  LongMemoryEntry,
  LongMemorySearchResult,
} from '../../shared/types/memory';
import type { SkillSummary } from '../../shared/types/skill';
import type { ProactiveTask } from '../../shared/types/tasks';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const window: any;

const emit = defineEmits(['close']);
const configStore = useConfigStore();
const { config } = storeToRefs(configStore);

const activeSection = ref('general');
const saved = ref(true);
const providers = ref<any[]>([]);
const isTestingModel = ref(false);
const toolModelTestResult = ref<{
  status: 'success' | 'warning' | 'error';
  message: string;
} | null>(null);
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
const memoryThreadsLoaded = ref(false);
const skills = ref<SkillSummary[]>([]);
const skillsLoading = ref(false);
const skillsError = ref('');
const skillSearchQuery = ref('');
const skillRoots = ref<Array<{ source: 'user' | 'codex'; path: string }>>([]);
const expandedSkillIds = ref<string[]>([]);
const skillContents = ref<Record<string, string>>({});
const skillContentLoading = ref<Record<string, boolean>>({});
const skillContentTruncated = ref<Record<string, boolean>>({});

const proactiveTasks = ref<ProactiveTask[]>([]);
const tasksLoading = ref(false);
const tasksError = ref('');
const taskCreateLoading = ref(false);
const taskCreateError = ref('');
const taskRunLoading = ref<Record<string, boolean>>({});
const taskThreads = ref<ChatThread[]>([]);

const SAFE_TASK_TOOLS = ['web', 'fetch', 'read_file', 'list_dir'] as const;
type SafeTaskTool = (typeof SAFE_TASK_TOOLS)[number];

const taskForm = ref<{
  name: string;
  prompt: string;
  interval_minutes: number;
  enabled: boolean;
  notify: boolean;
  provider_type: string;
  model: string;
  thread_id: string;
  tools: SafeTaskTool[];
}>({
  name: '',
  prompt: '',
  interval_minutes: 60,
  enabled: true,
  notify: true,
  provider_type: '',
  model: '',
  thread_id: '',
  tools: ['web', 'fetch'],
});

// Load providers
const loadProviders = async () => {
  try {
    providers.value = await window.electronAPI.providers.list();
  } catch (error) {
    console.error('Failed to load providers:', error);
  }
};

// Computed: Get available providers with their models
const availableProvidersWithModels = computed(() => {
  return providers.value
    .filter((p: any) => p.enabled)
    .map((p: any) => {
      let models: string[] = [];
      try {
        models = JSON.parse(p.models || '[]');
      } catch {
        models = [];
      }
      return {
        id: p.id,
        name: p.name,
        type: p.type,
        models: models.filter((m: string) => {
          // Filter out reasoning models
          const lowerModel = m.toLowerCase();
          return (
            !lowerModel.includes('o1') &&
            !lowerModel.includes('o3') &&
            !lowerModel.includes('thinking')
          );
        }),
      };
    })
    .filter((p: any) => p.models.length > 0);
});

const uniqueProviderTypes = computed(() => {
  const seen = new Set<string>();
  return availableProvidersWithModels.value
    .filter(provider => {
      if (!provider.type) return false;
      if (seen.has(provider.type)) return false;
      seen.add(provider.type);
      return true;
    })
    .map(provider => ({
      type: provider.type,
      name: `${provider.name} (${provider.type})`,
      models: provider.models as string[],
    }));
});

const taskAvailableModels = computed(() => {
  const type = taskForm.value.provider_type;
  if (!type) return [];
  const provider = availableProvidersWithModels.value.find(p => p.type === type);
  return provider?.models || [];
});

// Computed: Get selected tool model
const selectedToolModel = computed(() => {
  return config.value.toolModel.model;
});

// Test tool model performance
const testToolModel = async () => {
  if (!selectedToolModel.value) return;

  isTestingModel.value = true;
  toolModelTestResult.value = null;

  try {
    const startTime = Date.now();
    // Send a simple test message
    const result = await window.electronAPI.chat.send({
      providerType: getProviderTypeForModel(selectedToolModel.value),
      model: selectedToolModel.value,
      messages: [{ role: 'user', content: 'Say "OK"' }],
    });
    const responseTime = (Date.now() - startTime) / 1000;

    if (result.success) {
      if (responseTime < 2.5) {
        toolModelTestResult.value = {
          status: 'success',
          message: `Good! Response time: ${responseTime.toFixed(2)}s - Optimal for tool operations`,
        };
      } else if (responseTime < 5) {
        toolModelTestResult.value = {
          status: 'warning',
          message: `Slow. Response time: ${responseTime.toFixed(2)}s - Usable but may feel sluggish`,
        };
      } else {
        toolModelTestResult.value = {
          status: 'error',
          message: `Unusable. Response time: ${responseTime.toFixed(2)}s - Too slow for responsive tool use`,
        };
      }
    } else {
      toolModelTestResult.value = {
        status: 'error',
        message: `Test failed: ${result.error || 'Unknown error'}`,
      };
    }
  } catch (error: any) {
    toolModelTestResult.value = {
      status: 'error',
      message: `Test failed: ${error.message || 'Unknown error'}`,
    };
  } finally {
    isTestingModel.value = false;
  }
};

// Get provider type for a model
const getProviderTypeForModel = (model: string): string => {
  for (const provider of availableProvidersWithModels.value) {
    if (provider.models.includes(model)) {
      return provider.type;
    }
  }
  return 'openai'; // Default fallback
};

watch(
  () => availableProvidersWithModels.value,
  providersList => {
    if (!taskForm.value.provider_type && providersList.length > 0) {
      taskForm.value.provider_type = providersList[0].type;
    }

    const models = taskAvailableModels.value;
    if (!taskForm.value.model || (models.length > 0 && !models.includes(taskForm.value.model))) {
      taskForm.value.model = models[0] || '';
    }
  },
  { immediate: true }
);

watch(
  () => taskForm.value.provider_type,
  () => {
    const models = taskAvailableModels.value;
    if (!taskForm.value.model || (models.length > 0 && !models.includes(taskForm.value.model))) {
      taskForm.value.model = models[0] || '';
    }
  }
);

const menuItems = [
  { key: 'general', label: 'General', icon: Cog },
  { key: 'ui', label: 'Appearance', icon: Palette },
  { key: 'provider', label: 'Providers', icon: Bot },
  // { key: "chat", label: "Chat", icon: MessageCircleMore },
  // { key: "network", label: "Network", icon: Globe },
  // { key: "security", label: "Security", icon: Lock },
  // { key: "advanced", label: "Advanced", icon: Zap },
  // { key: "keybindings", label: "Keybindings", icon: Keyboard },
  { key: 'memory', label: 'Memory', icon: Brain },
  { key: 'tasks', label: 'Tasks', icon: AlarmClock },
  { key: 'skills', label: 'Skills', icon: Wand2 },
];

const activeSectionMeta = computed(() => {
  return (
    menuItems.find(item => item.key === activeSection.value) || {
      key: activeSection.value,
      label: 'Settings',
      icon: Cog,
    }
  );
});

const activeSectionLabel = computed(() => activeSectionMeta.value.label);
const activeSectionIcon = computed(() => activeSectionMeta.value.icon);

const themeOptions = ['light', 'dark', 'system'] as const;
const densityOptions = [
  { key: 'compact' as const, label: 'Compact' },
  { key: 'comfortable' as const, label: 'Comfortable' },
  { key: 'spacious' as const, label: 'Spacious' },
];

// 自动保存防抖
let saveTimer: NodeJS.Timeout;
const autoSave = () => {
  saved.value = false;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    await configStore.saveConfig();
    saved.value = true;
  }, 300);
};

// Action 封装
const setFontSize = (size: number) => {
  configStore.updateUi('fontSize', size);
  autoSave();
};

const setDensity = (density: AppConfig['ui']['density']) => {
  configStore.updateUi('density', density);
  autoSave();
};

const setUiMetric = (
  key:
    | 'chatContentPadding'
    | 'composerPadding'
    | 'messageBubblePaddingX'
    | 'messageBubblePaddingY'
    | 'messageGap',
  value: number
) => {
  configStore.updateUi(key, value);
  autoSave();
};

const updateGeneral = <K extends keyof AppConfig['general']>(
  key: K,
  value: AppConfig['general'][K]
) => {
  configStore.updateGeneral(key, value);
  autoSave();
};

// 处理嵌套路径的通用方法
const updateNested = (path: string, value: any) => {
  const keys = path.split('.');
  let target: any = config.value;

  for (let i = 0; i < keys.length - 1; i++) {
    target = target[keys[i]];
  }

  target[keys[keys.length - 1]] = value;
  autoSave();
};

const updateNetwork = (path: string, value: any) => updateNested(path, value);
const updateSecurity = <K extends keyof AppConfig['security']>(
  key: K,
  value: AppConfig['security'][K]
) => {
  config.value.security[key] = value;
  autoSave();
};
const updateAdvanced = <K extends keyof AppConfig['advanced']>(
  key: K,
  value: AppConfig['advanced'][K]
) => {
  config.value.advanced[key] = value;
  autoSave();
};
const updateKeybinding = <K extends keyof AppConfig['keybindings']>(key: K, value: string) => {
  config.value.keybindings[key] = value;
  autoSave();
};
const updateMemory = <K extends keyof AppConfig['memory']>(
  key: K,
  value: AppConfig['memory'][K]
) => {
  config.value.memory[key] = value;
  autoSave();
};
const updateToolModel = (key: 'model', value: string) => {
  config.value.toolModel[key] = value;
  autoSave();
};

const updateToolExecution = <K extends keyof AppConfig['toolExecution']>(
  key: K,
  value: AppConfig['toolExecution'][K]
) => {
  config.value.toolExecution[key] = value;
  autoSave();
};

const shellHighRiskPatternText = computed(() =>
  (config.value.toolExecution.shellHighRiskPatterns || []).join('\n')
);
const hasMemoryQuery = computed(() => memorySearchQuery.value.trim().length > 0);

const updateShellHighRiskPatterns = (value: string) => {
  const patterns = value
    .split(/\r?\n/)
    .map(pattern => pattern.trim())
    .filter(Boolean)
    .slice(0, 100);
  updateToolExecution('shellHighRiskPatterns', patterns);
};

const resetSection = (section: keyof AppConfig) => {
  configStore.resetSection(section);
  saved.value = true;
};

const saveAndClose = async () => {
  await configStore.saveConfig();
  saved.value = true;
  emit('close');
};

// 工具函数
const formatLabel = (key: string) => {
  return key.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase());
};

const formatTimestamp = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
};

const formatRole = (role: string) => {
  if (!role) return 'Unknown';
  return role.charAt(0).toUpperCase() + role.slice(1);
};

const formatJsonList = (raw: string | null | undefined) => {
  if (!raw) return '';
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.join(', ');
    if (typeof parsed === 'string') return parsed;
    return JSON.stringify(parsed);
  } catch {
    return raw;
  }
};

const formatJson = (raw: string | null | undefined) => {
  if (!raw) return '';
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === 'string') return parsed;
    return JSON.stringify(parsed);
  } catch {
    return raw;
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
      await refreshMemory();
    }
  } catch (error: any) {
    memoryError.value = `Failed to load threads: ${error?.message || 'Unknown error'}`;
  }
};

const selectMemoryThread = async (threadId: string) => {
  selectedMemoryThreadId.value = threadId;
  memorySearchResults.value = [];
  memorySearchError.value = '';
  await refreshMemory();
};

const refreshMemory = async () => {
  if (!selectedMemoryThreadId.value) return;
  memoryLoading.value = true;
  memoryError.value = '';
  try {
    const [shortEntries, longEntries] = await Promise.all([
      window.electronAPI.memory.short.list(selectedMemoryThreadId.value, 50),
      window.electronAPI.memory.long.list(selectedMemoryThreadId.value, 25),
    ]);
    shortMemoryEntries.value = Array.isArray(shortEntries) ? shortEntries : [];
    longMemoryEntries.value = Array.isArray(longEntries) ? longEntries : [];
  } catch (error: any) {
    memoryError.value = `Failed to load memory: ${error?.message || 'Unknown error'}`;
  } finally {
    memoryLoading.value = false;
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
    const results = await window.electronAPI.memory.long.search(
      selectedMemoryThreadId.value,
      memorySearchQuery.value.trim(),
      {
        limit: config.value.memory.maxRetrievalCount,
        threshold: config.value.memory.similarThreshold,
        force: true,
      }
    );
    memorySearchResults.value = Array.isArray(results) ? results : [];
  } catch (error: any) {
    memorySearchError.value = `Search failed: ${error?.message || 'Unknown error'}`;
  } finally {
    memorySearchLoading.value = false;
  }
};

const loadTaskThreads = async () => {
  try {
    const threads = await window.electronAPI.chat.threads.list();
    taskThreads.value = Array.isArray(threads) ? threads : [];
  } catch (error) {
    taskThreads.value = [];
  }
};

const loadProactiveTasks = async () => {
  tasksLoading.value = true;
  tasksError.value = '';
  try {
    const list = await window.electronAPI.tasks.list();
    proactiveTasks.value = Array.isArray(list) ? list : [];
  } catch (error: any) {
    tasksError.value = `Failed to load tasks: ${error?.message || 'Unknown error'}`;
    proactiveTasks.value = [];
  } finally {
    tasksLoading.value = false;
  }
};

const refreshTasks = async () => {
  await Promise.all([loadProactiveTasks(), loadTaskThreads()]);
};

const toggleTaskTool = (tool: SafeTaskTool, checked: boolean) => {
  const existing = taskForm.value.tools;
  if (checked) {
    if (!existing.includes(tool)) {
      taskForm.value.tools = [...existing, tool];
    }
    return;
  }
  taskForm.value.tools = existing.filter(t => t !== tool);
};

const createProactiveTask = async () => {
  taskCreateError.value = '';
  const name = taskForm.value.name.trim();
  const prompt = taskForm.value.prompt.trim();
  if (!name) {
    taskCreateError.value = 'Task name is required.';
    return;
  }
  if (!prompt) {
    taskCreateError.value = 'Task prompt is required.';
    return;
  }
  if (!taskForm.value.provider_type) {
    taskCreateError.value = 'Please select a provider.';
    return;
  }
  if (!taskForm.value.model) {
    taskCreateError.value = 'Please select a model.';
    return;
  }

  taskCreateLoading.value = true;
  try {
    const result = await window.electronAPI.tasks.create({
      name,
      prompt,
      provider_type: taskForm.value.provider_type,
      model: taskForm.value.model,
      interval_minutes: taskForm.value.interval_minutes,
      enabled: taskForm.value.enabled,
      notify: taskForm.value.notify,
      thread_id: taskForm.value.thread_id || null,
      tools: taskForm.value.tools,
    });

    if (result?.success === false) {
      taskCreateError.value = result?.error || 'Failed to create task.';
      return;
    }

    taskForm.value.name = '';
    taskForm.value.prompt = '';
    taskForm.value.thread_id = '';
    await loadProactiveTasks();
  } catch (error: any) {
    taskCreateError.value = `Failed to create task: ${error?.message || 'Unknown error'}`;
  } finally {
    taskCreateLoading.value = false;
  }
};

const runTaskNow = async (task: ProactiveTask) => {
  if (taskRunLoading.value[task.id]) return;
  taskRunLoading.value = { ...taskRunLoading.value, [task.id]: true };
  try {
    const result = await window.electronAPI.tasks.runNow(task.id);
    if (result?.success === false) {
      tasksError.value = result?.error || 'Task run failed.';
    }
  } catch (error: any) {
    tasksError.value = `Task run failed: ${error?.message || 'Unknown error'}`;
  } finally {
    taskRunLoading.value = { ...taskRunLoading.value, [task.id]: false };
    await loadProactiveTasks();
    await loadTaskThreads();
  }
};

const deleteTask = async (task: ProactiveTask) => {
  const confirmed = window.confirm(`Delete task "${task.name}"?\nThis cannot be undone.`);
  if (!confirmed) return;
  try {
    const result = await window.electronAPI.tasks.delete(task.id);
    if (result?.success === false) {
      tasksError.value = result?.error || 'Failed to delete task.';
      return;
    }
    proactiveTasks.value = proactiveTasks.value.filter(t => t.id !== task.id);
  } catch (error: any) {
    tasksError.value = `Failed to delete task: ${error?.message || 'Unknown error'}`;
  }
};

const toggleTaskEnabled = async (task: ProactiveTask, enabled: boolean) => {
  try {
    const result = await window.electronAPI.tasks.update(task.id, { enabled });
    if (result?.success === false) {
      tasksError.value = result?.error || 'Failed to update task.';
      return;
    }
    await loadProactiveTasks();
  } catch (error: any) {
    tasksError.value = `Failed to update task: ${error?.message || 'Unknown error'}`;
  }
};

const toggleTaskNotify = async (task: ProactiveTask, notify: boolean) => {
  try {
    const result = await window.electronAPI.tasks.update(task.id, { notify });
    if (result?.success === false) {
      tasksError.value = result?.error || 'Failed to update task.';
      return;
    }
    await loadProactiveTasks();
  } catch (error: any) {
    tasksError.value = `Failed to update task: ${error?.message || 'Unknown error'}`;
  }
};

const updateTaskInterval = async (task: ProactiveTask, raw: string) => {
  const next = Number.parseInt(raw, 10);
  if (!Number.isFinite(next) || next <= 0) {
    tasksError.value = 'Interval must be a positive number (minutes).';
    return;
  }
  try {
    const result = await window.electronAPI.tasks.update(task.id, { interval_minutes: next });
    if (result?.success === false) {
      tasksError.value = result?.error || 'Failed to update task.';
      return;
    }
    await loadProactiveTasks();
  } catch (error: any) {
    tasksError.value = `Failed to update task: ${error?.message || 'Unknown error'}`;
  }
};

const loadSkillRoots = async () => {
  try {
    const roots = await window.electronAPI.skills.roots();
    skillRoots.value = Array.isArray(roots) ? roots : [];
  } catch (error) {
    skillRoots.value = [];
  }
};

const refreshSkills = async () => {
  skillsLoading.value = true;
  skillsError.value = '';
  try {
    const list = await window.electronAPI.skills.list();
    skills.value = Array.isArray(list) ? list : [];
  } catch (error: any) {
    skillsError.value = `Failed to load skills: ${error?.message || 'Unknown error'}`;
    skills.value = [];
  } finally {
    skillsLoading.value = false;
  }
};

const openSkillsFolder = async (source?: 'user' | 'codex') => {
  try {
    const result = await window.electronAPI.skills.openRoot(source);
    if (result?.success === false) {
      skillsError.value = result?.error || 'Failed to open skills folder';
    }
  } catch (error: any) {
    skillsError.value = `Failed to open skills folder: ${error?.message || 'Unknown error'}`;
  }
};

const openSkillFolder = async (id: string) => {
  try {
    const result = await window.electronAPI.skills.openSkill(id);
    if (result?.success === false) {
      skillsError.value = result?.error || 'Failed to open skill folder';
    }
  } catch (error: any) {
    skillsError.value = `Failed to open skill folder: ${error?.message || 'Unknown error'}`;
  }
};

const isSkillExpanded = (id: string) => expandedSkillIds.value.includes(id);

const toggleSkillContent = async (id: string) => {
  const alreadyExpanded = isSkillExpanded(id);
  if (alreadyExpanded) {
    expandedSkillIds.value = expandedSkillIds.value.filter(existing => existing !== id);
    return;
  }

  expandedSkillIds.value = [...expandedSkillIds.value, id];

  if (typeof skillContents.value[id] === 'string') {
    return;
  }

  skillContentLoading.value = { ...skillContentLoading.value, [id]: true };
  try {
    const result = await window.electronAPI.skills.read(id, { maxChars: 20000 });
    if (result?.success === false) {
      skillsError.value = result?.error || 'Failed to read skill content';
      skillContents.value = { ...skillContents.value, [id]: '' };
      skillContentTruncated.value = { ...skillContentTruncated.value, [id]: false };
      return;
    }
    skillContents.value = { ...skillContents.value, [id]: result?.content || '' };
    skillContentTruncated.value = {
      ...skillContentTruncated.value,
      [id]: Boolean(result?.truncated),
    };
  } catch (error: any) {
    skillsError.value = `Failed to read skill content: ${error?.message || 'Unknown error'}`;
  } finally {
    skillContentLoading.value = { ...skillContentLoading.value, [id]: false };
  }
};

const filteredSkills = computed(() => {
  const query = skillSearchQuery.value.trim().toLowerCase();
  if (!query) return skills.value;
  return skills.value.filter(skill => {
    const hay = `${skill.name} ${skill.description} ${skill.id} ${skill.source}`.toLowerCase();
    return hay.includes(query);
  });
});

const personalSkills = computed(() =>
  filteredSkills.value.filter(skill => skill.source === 'user')
);

const codexSkills = computed(() =>
  filteredSkills.value.filter(skill => skill.source === 'codex')
);

onMounted(async () => {
  if (!configStore.initialized) {
    configStore.initialize();
  }
  await loadProviders();
  await loadMemoryThreads();
  await loadSkillRoots();

  try {
    window.electronAPI.tasks.removeAllListeners?.();
    window.electronAPI.tasks.onPush((payload: any) => {
      if (payload?.type === 'task-result') {
        void loadProactiveTasks();
      }
    });
  } catch {
    // Ignore missing tasks IPC when running older builds.
  }
});

watch(activeSection, section => {
  if (section === 'memory') {
    void loadMemoryThreads();
  }
  if (section === 'tasks') {
    void refreshTasks();
  }
  if (section === 'skills') {
    void refreshSkills();
  }
});

onUnmounted(() => {
  try {
    window.electronAPI.tasks.removeAllListeners?.();
  } catch {
    // ignore
  }
});
</script>

<style scoped>
.input-label {
  display: block;
  margin-bottom: 16px;
}

.input-label input,
.input-label select,
.input-label textarea {
  width: 100%;
  padding: 8px 12px;
  margin-top: 6px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background: var(--bg-secondary);
  color: var(--text-primary);
  font-size: var(--font-size);
}

.input-label textarea {
  resize: vertical;
  min-height: 96px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New',
    monospace;
}

.checkbox-label {
  display: block;
  margin-bottom: 12px;
  cursor: pointer;
}

.checkbox-label input[type='checkbox'] {
  margin-right: 8px;
  accent-color: var(--accent-color);
}

/* 密度面板样式 */
/* section header styles replaced by settings-header */

.add-btn {
  background: var(--accent-color);
  color: white;
  border: none;
  padding: 8px 16px;
  border-radius: 6px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 500;
  transition: all 0.2s;
}

.add-btn:hover {
  background: var(--accent-hover);
}

.action-btn {
  padding: 10px 16px;
  border-radius: 8px;
  cursor: pointer;
  font-size: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  transition: all 0.2s;
}

.secondary-btn {
  background: transparent;
  border: 1px solid var(--border-color);
  color: var(--text-primary);
}

.secondary-btn:hover {
  background: var(--bg-hover);
  border-color: var(--accent-color);
}

/* Switch Style */
.switch {
  position: relative;
  display: inline-block;
  width: 40px;
  height: 20px;
}

.switch input {
  opacity: 0;
  width: 0;
  height: 0;
}

.slider {
  position: absolute;
  cursor: pointer;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: var(--border-color);
  transition: 0.4s;
}

.slider::before {
  position: absolute;
  content: '';
  height: 16px;
  width: 16px;
  left: 2px;
  bottom: 2px;
  background-color: white;
  transition: 0.4s;
}

input:checked + .slider {
  background-color: var(--accent-color);
}

input:checked + .slider::before {
  transform: translateX(20px);
}

.slider.round {
  border-radius: 20px;
}

.slider.round::before {
  border-radius: 50%;
}

/* 强制覆盖为暗色主题以匹配 ChatView */
.settings-container {
  display: flex;
  height: 100vh;
  font-size: var(--font-size);
  background: var(--bg-secondary);
  color: var(--text-primary);
  padding: 4px 4px 0;
  gap: 6px;
  box-sizing: border-box;
}

/* Titlebar Drag Region */
.titlebar-drag-region {
  position: fixed;
  top: 4px;
  left: 4px;
  right: 4px;
  height: 20px;
  -webkit-app-region: drag;
  z-index: 9999;
}

/* Custom Scrollbar */
::-webkit-scrollbar {
  width: 8px;
}

::-webkit-scrollbar-track {
  background: transparent;
  margin: 4px 0;
}

::-webkit-scrollbar-thumb {
  background-color: var(--border-color);
  border-radius: 4px;
}

::-webkit-scrollbar-thumb:hover {
  background-color: var(--text-muted);
}

/* 左侧导航 */
.settings-nav {
  width: 220px;
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: 18px;
  padding: 24px 16px;
  padding-top: 40px;
  /* Space for drag region */
  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.08);
  overflow: hidden;
  height: calc(100vh - 4px);
  position: relative;
}

.mac-controls {
  position: absolute;
  top: 14px;
  left: 16px;
  display: flex;
  gap: 8px;
}

.mac-dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  display: inline-block;
}

.dot-red {
  background: #ff5f57;
}

.dot-yellow {
  background: #febc2e;
}

.dot-green {
  background: #28c840;
}

.nav-header h1 {
  font-size: 1.5em;
  margin-bottom: 8px;
}

.providers {
  color: var(--text-secondary);
  font-size: 0.875em;
  cursor: pointer;
}

.nav-menu {
  margin-top: 22px;
  list-style: none;
  border-color: var(--border-color);
}

.nav-menu li {
  padding: 10px 12px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
  transition: all 0.2s;
}

.nav-menu li:hover {
  background: var(--bg-hover);
}

.nav-menu li.active {
  background: color-mix(in srgb, var(--accent-color) 16%, var(--bg-primary));
  color: var(--accent-color);
  box-shadow: inset 3px 0 0 var(--accent-color);
}

/* 右侧内容 */
.settings-content {
  flex: 1;
  padding: 0 22px;
  /* Space for fixed footer */
  overflow-y: auto;
  background: transparent;
  border: none;
  border-radius: 0;
  box-shadow: none;
  height: calc(100vh - 4px);
  position: relative;
  display: flex;
  flex-direction: column;
}

.config-section {
  max-width: 860px;
  padding-top: 8px;
  flex: 1 0 auto;
}

.settings-card,
.config-group {
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: 18px;
  padding: 20px 22px;
  margin-bottom: 24px;
  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.06);
}

.skills-toolbar {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
  margin-bottom: 10px;
}

.skills-toolbar-left {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.skills-subtitle {
  color: var(--text-secondary);
  font-size: 0.92em;
}

.skills-toolbar-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.skills-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border-radius: 10px;
}

.skills-paths {
  margin: 10px 0 14px;
  border: 1px solid var(--border-color);
  border-radius: 12px;
  overflow: hidden;
}

.skills-path-row {
  display: flex;
  gap: 10px;
  align-items: center;
  padding: 10px 12px;
  background: var(--bg-secondary);
  border-top: 1px solid var(--border-color);
}

.skills-path-row:first-child {
  border-top: none;
}

.skills-path-label {
  width: 70px;
  color: var(--text-secondary);
  font-size: 0.9em;
}

.skills-path-value {
  flex: 1;
  color: var(--text-primary);
  font-size: 0.85em;
  background: transparent;
  padding: 0;
  border: none;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.skills-search {
  margin-top: 8px;
  margin-bottom: 12px;
}

.skills-search input {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--border-color);
  border-radius: 10px;
  background: var(--bg-secondary);
  color: var(--text-primary);
  font-size: var(--font-size);
}

.skills-empty {
  color: var(--text-secondary);
  font-size: 0.95em;
  padding: 10px 2px;
}

.skills-error {
  color: var(--danger-color);
  font-size: 0.95em;
  margin: 10px 0 0;
}

.skills-groups {
  margin-top: 8px;
}

.skills-group {
  margin-top: 18px;
}

.skills-group-title {
  display: flex;
  align-items: center;
  gap: 10px;
  font-weight: 600;
  margin-bottom: 10px;
}

.skills-count-pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 2px 10px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--accent-color) 14%, var(--bg-secondary));
  border: 1px solid color-mix(in srgb, var(--accent-color) 22%, var(--border-color));
  color: var(--text-primary);
  font-size: 0.85em;
}

.skills-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.skill-item {
  border: 1px solid var(--border-color);
  border-radius: 14px;
  background: var(--bg-secondary);
  padding: 14px 14px;
}

.skill-item-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.skill-item-meta {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.skill-name {
  font-weight: 600;
  color: var(--text-primary);
}

.skill-desc {
  color: var(--text-secondary);
  font-size: 0.93em;
  line-height: 1.35;
}

.skill-id {
  color: var(--text-secondary);
  font-size: 0.82em;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono',
    'Courier New', monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100%;
}

.skill-item-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.skills-mini-btn {
  padding: 8px 10px;
  border: 1px solid var(--border-color);
  border-radius: 10px;
  background: transparent;
  color: var(--text-primary);
  cursor: pointer;
  transition: all 0.2s;
  font-size: 0.9em;
}

.skills-mini-btn:hover {
  background: var(--bg-hover);
  border-color: color-mix(in srgb, var(--accent-color) 45%, var(--border-color));
}

.skill-content {
  margin-top: 12px;
}

.skill-content-pre {
  max-height: 320px;
  overflow: auto;
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: 12px;
  padding: 12px;
  font-size: 0.88em;
  line-height: 1.35;
  color: var(--text-primary);
  white-space: pre-wrap;
  word-break: break-word;
}

.skills-truncated {
  color: var(--text-secondary);
  font-size: 0.85em;
  margin-top: 8px;
}

.task-form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.task-form-actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  margin-top: 4px;
}

.task-tools {
  border: 1px solid var(--border-color);
  border-radius: 14px;
  padding: 14px 14px;
  background: var(--bg-secondary);
  margin-bottom: 14px;
}

.task-tools-title {
  font-weight: 600;
  color: var(--text-secondary);
  font-size: 0.92em;
  margin-bottom: 10px;
}

.task-tools-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px 12px;
}

.tasks-empty {
  color: var(--text-secondary);
  font-size: 0.95em;
  padding: 10px 2px;
}

.tasks-error {
  color: var(--danger-color);
  font-size: 0.95em;
  margin: 10px 0 0;
  white-space: pre-wrap;
}

.tasks-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.task-item {
  border: 1px solid var(--border-color);
  border-radius: 14px;
  background: var(--bg-secondary);
  padding: 14px 14px;
}

.task-item-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.task-item-title {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.task-name {
  font-weight: 600;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 520px;
}

.task-status {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 2px 10px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  border: 1px solid var(--border-color);
  background: color-mix(in srgb, var(--accent-color) 10%, var(--bg-primary));
  color: var(--text-primary);
}

.task-status.status-running {
  background: color-mix(in srgb, var(--accent-color) 18%, var(--bg-primary));
  border-color: color-mix(in srgb, var(--accent-color) 40%, var(--border-color));
}

.task-status.status-success {
  background: color-mix(in srgb, var(--success-color, var(--accent-color)) 16%, var(--bg-primary));
  border-color: color-mix(
    in srgb,
    var(--success-color, var(--accent-color)) 35%,
    var(--border-color)
  );
}

.task-status.status-error {
  background: color-mix(in srgb, var(--danger-color) 14%, var(--bg-primary));
  border-color: color-mix(in srgb, var(--danger-color) 35%, var(--border-color));
}

.task-item-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.task-item-meta {
  display: flex;
  align-items: flex-end;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 12px;
}

.task-compact-check {
  margin-bottom: 0;
}

.task-inline-field {
  margin-bottom: 0;
  width: 160px;
}

.task-inline-field input {
  margin-top: 4px;
}

.task-item-times {
  display: flex;
  gap: 14px;
  flex-wrap: wrap;
  margin-top: 10px;
  color: var(--text-secondary);
  font-size: 0.9em;
}

.task-meta-label {
  color: var(--text-muted);
  font-weight: 600;
  margin-right: 6px;
}

.task-error-block {
  margin-top: 12px;
  background: color-mix(in srgb, var(--danger-color) 7%, var(--bg-primary));
  border: 1px solid color-mix(in srgb, var(--danger-color) 25%, var(--border-color));
  border-radius: 12px;
  padding: 10px 12px;
}

@media (max-width: 840px) {
  .task-form-grid {
    grid-template-columns: 1fr;
  }

  .task-tools-grid {
    grid-template-columns: 1fr;
  }

  .task-name {
    max-width: 320px;
  }
}

.config-section > .settings-card:first-of-type,
.config-section > .config-group:first-of-type {
  margin-top: 6px;
}

.config-group input[type='range'] {
  width: 100%;
  margin-top: 10px;
  accent-color: var(--accent-color);
}

.config-group .value-badge {
  font-size: 0.85em;
}

.config-group h3 {
  margin-bottom: 10px;
  font-size: 1.02em;
  font-weight: 600;
}

.group-description {
  color: var(--text-secondary);
  font-size: 0.95em;
  margin-bottom: 16px;
}

.card-title {
  font-size: 1.1em;
  font-weight: 600;
  margin-bottom: 12px;
}

.card-help {
  color: var(--text-secondary);
  font-size: 0.93em;
  margin: 8px 0 16px;
}

.settings-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-top: 16px;
  padding-bottom: 14px;
  border-bottom: 1px solid var(--border-color);
  margin-bottom: 22px;
  position: sticky;
  top: 0;
  background: var(--bg-secondary);
  z-index: 5;
  padding-left: 6px;
  padding-right: 6px;
}

.settings-header-left {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 1.2em;
  font-weight: 600;
  position: relative;
  padding-left: 10px;
}

.settings-header-left::before {
  content: '';
  position: absolute;
  left: 0;
  top: 4px;
  bottom: 4px;
  width: 3px;
  border-radius: 999px;
  background: var(--accent-color);
}

.settings-header-left .icon {
  color: var(--accent-color);
}

.settings-header-right {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 0.9em;
  color: var(--text-secondary);
}

.settings-header-right.is-unsaved {
  color: #ff6b2d;
}

.settings-header-right .unsaved-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: currentColor;
  opacity: 0;
}

.settings-header-right.is-unsaved .unsaved-dot {
  opacity: 1;
}

.slider-field {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 12px;
  font-weight: 600;
}

.slider-hint {
  color: var(--text-secondary);
  font-size: 0.88em;
  margin-top: 8px;
}

.slider-legend {
  display: flex;
  justify-content: space-between;
  font-size: 0.8em;
  color: var(--text-muted);
  margin-top: 6px;
}

input[type='range'] {
  width: 100%;
  margin-top: 8px;
  accent-color: var(--accent-color);
}

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
  height: 38px;
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

/* 主题按钮组 */
.button-group {
  display: flex;
  gap: 8px;
}

.button-group button {
  padding: 8px 16px;
  border: 1px solid var(--border-color);
  background: var(--bg-secondary);
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s;
}

.button-group button.active {
  background: var(--accent-color);
  color: white;
  border-color: var(--accent-color);
}

/* 滑动条 */
.slider-label {
  display: flex;
  justify-content: space-between;
  margin-bottom: 8px;
}

.value-badge {
  background: var(--bg-active);
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 0.875em;
}

.slider-container input[type='range'] {
  width: 100%;
  margin: 12px 0;
}

.slider-marks {
  display: flex;
  justify-content: space-between;
  font-size: 0.75em;
  color: var(--text-secondary);
}

/* 密度卡片 */
.density-options {
  display: flex;
  gap: 16px;
}

.density-card {
  flex: 1;
  padding: 16px;
  border: 2px solid var(--border-color);
  border-radius: 8px;
  cursor: pointer;
  text-align: center;
  transition: all 0.2s;
}

.density-card.active {
  border-color: var(--accent-color);
}

.density-preview {
  height: 40px;
  background: var(--bg-secondary);
  border-radius: 4px;
  margin-bottom: 8px;
  position: relative;
}

.density-preview::before,
.density-preview::after {
  content: '';
  position: absolute;
  background: var(--border-color);
  border-radius: 2px;
}

/* Compact: 小间距 */
.density-preview[data-density='compact']::before {
  top: 6px;
  left: 6px;
  right: 6px;
  height: 4px;
}

.density-preview[data-density='compact']::after {
  bottom: 6px;
  left: 6px;
  right: 6px;
  height: 4px;
}

/* Comfortable: 中等间距 */
.density-preview[data-density='comfortable']::before {
  top: 8px;
  left: 8px;
  right: 8px;
  height: 6px;
}

.density-preview[data-density='comfortable']::after {
  bottom: 8px;
  left: 8px;
  right: 8px;
  height: 6px;
}

/* Spacious: 大间距 */
.density-preview[data-density='spacious']::before {
  top: 12px;
  left: 12px;
  right: 12px;
  height: 8px;
}

.density-preview[data-density='spacious']::after {
  bottom: 12px;
  left: 12px;
  right: 12px;
  height: 8px;
}

/* 重置按钮 */
.reset-btn {
  padding: 8px 16px;
  color: var(--danger-color);
  background: transparent;
  border: 1px solid var(--danger-color);
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s;
}

.reset-btn:hover {
  background: var(--danger-color);
  color: white;
}

/* 底部操作栏 */
.settings-footer {
  position: sticky;
  margin-top: auto;
  bottom: 0;
  padding: 16px 0 12px;
  border-top: 1px solid var(--border-color);
  background: var(--bg-secondary);
  display: flex;
  justify-content: flex-end;
  /* Always keep buttons on the right */
  align-items: center;
  z-index: 10;
}

.save-status {
  color: var(--success-color);
  font-size: 0.875em;
  margin-right: auto;
  /* Push buttons to the right */
  display: flex;
  align-items: center;
  gap: 4px;
}

.save-status::before {
  content: '✓';
  font-weight: bold;
}

.footer-actions {
  display: flex;
  gap: 12px;
}

.footer-actions button {
  padding: 8px 20px;
  border-radius: 8px;
  cursor: pointer;
  border: 1px solid transparent;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  font-weight: 500;
  font-size: 0.9em;
}

.footer-actions .secondary {
  background: transparent;
  border-color: var(--border-color);
  color: var(--text-primary);
}

.footer-actions .secondary:hover {
  background: var(--bg-hover);
  border-color: var(--text-muted);
}

.footer-actions .primary {
  background: var(--accent-color);
  color: white;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.footer-actions .primary:hover {
  background: var(--accent-hover);
  transform: translateY(-1px);
  box-shadow: 0 4px 6px rgba(0, 0, 0, 0.15);
}

.footer-actions .primary:active {
  transform: translateY(0);
}

/* 响应式密度 */
.settings-container[data-density='compact'] {
  --spacing-unit: 4px;
}

.settings-container[data-density='spacious'] {
  --spacing-unit: 16px;
}

/* Tool Model Selector Styles */
.tool-model-selector {
  margin-top: 12px;
}

.tool-model-select {
  font-family: monospace;
  font-size: 13px;
}

.label-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.test-model-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  background: transparent;
  border: 1px solid var(--border-color);
  color: var(--text-secondary);
  padding: 4px 8px;
  border-radius: 6px;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.2s;
}

.test-model-btn:hover:not(:disabled) {
  background: var(--bg-hover);
  border-color: var(--accent-color);
  color: var(--accent-color);
}

.test-model-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.test-result {
  margin-top: 12px;
  padding: 10px 12px;
  border-radius: 6px;
  font-size: 13px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.test-result.success {
  background: rgba(34, 197, 94, 0.15);
  color: #22c55e;
  border: 1px solid rgba(34, 197, 94, 0.3);
}

.test-result.warning {
  background: rgba(251, 191, 36, 0.15);
  color: #fbbf24;
  border: 1px solid rgba(251, 191, 36, 0.3);
}

.test-result.error {
  background: rgba(239, 68, 68, 0.15);
  color: #ef4444;
  border: 1px solid rgba(239, 68, 68, 0.3);
}

.tool-model-info {
  margin-top: 16px;
  padding: 16px;
  background: var(--bg-secondary);
  border-radius: 8px;
  border: 1px solid var(--border-color);
}

.info-text {
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.6;
  margin: 8px 0;
}

.info-text:first-child {
  margin-top: 0;
}

.info-text:last-child {
  margin-bottom: 0;
}

.warning-text {
  color: #fbbf24;
  font-size: 12px;
}

.animate-spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}
</style>
