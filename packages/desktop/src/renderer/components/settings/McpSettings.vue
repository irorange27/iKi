<template>
  <section class="config-section mcp-section">
    <div class="config-group">
      <h3>{{ t('settings.mcp.title') }}</h3>
      <p class="group-description">{{ t('settings.mcp.description') }}</p>
      <label class="checkbox-label">
        <input
          type="checkbox"
          :checked="config.mcp.enabled"
          @change="updateMcp('enabled', ($event.target as HTMLInputElement).checked)"
        />
        {{ t('settings.mcp.enable') }}
      </label>
      <label class="checkbox-label">
        <input
          type="checkbox"
          :checked="config.mcp.connectOnStartup"
          @change="updateMcp('connectOnStartup', ($event.target as HTMLInputElement).checked)"
        />
        {{ t('settings.mcp.connectOnStartup') }}
      </label>
      <label class="checkbox-label">
        <input
          type="checkbox"
          :checked="config.mcp.allowRemoteServers"
          @change="updateMcp('allowRemoteServers', ($event.target as HTMLInputElement).checked)"
        />
        {{ t('settings.mcp.allowRemoteServers') }}
      </label>
      <p v-if="!config.mcp.allowRemoteServers" class="group-description warning-text">
        {{ t('settings.mcp.remoteBlocked') }}
      </p>

      <label class="input-label">
        <span>{{ t('settings.mcp.defaultApprovalMode') }}</span>
        <SettingsSelect
          :model-value="config.mcp.defaultApprovalMode"
          :options="mcpDefaultApprovalModeOptions"
          :aria-label="t('settings.mcp.defaultApprovalModeAria')"
          @update:model-value="updateDefaultApprovalModeSelection"
        />
      </label>

      <div class="config-inline">
        <label class="input-label">
          <span>{{ t('settings.mcp.requestTimeoutMs') }}</span>
          <input
            type="number"
            min="1000"
            step="500"
            :value="config.mcp.requestTimeoutMs"
            @input="
              updateMcp(
                'requestTimeoutMs',
                Math.max(1000, parseInt(($event.target as HTMLInputElement).value || '0'))
              )
            "
          />
        </label>
        <label class="input-label">
          <span>{{ t('settings.mcp.maxConcurrentRequests') }}</span>
          <input
            type="number"
            min="1"
            step="1"
            :value="config.mcp.maxConcurrentRequests"
            @input="
              updateMcp(
                'maxConcurrentRequests',
                Math.max(1, parseInt(($event.target as HTMLInputElement).value || '0'))
              )
            "
          />
        </label>
      </div>
    </div>

    <div class="settings-card">
      <div class="card-header">
        <div>
          <div class="card-title">{{ t('settings.mcp.serversTitle') }}</div>
          <div class="card-subtitle">
            {{ t('settings.mcp.configuredCount', { count: servers.length }) }}
          </div>
        </div>
        <div class="card-actions">
          <button class="secondary-btn" @click="() => loadServers()" :disabled="serversLoading">
            <RefreshCw :size="14" :class="{ 'animate-spin': serversLoading }" />
            {{ serversLoading ? t('settings.mcp.loading') : t('common.refresh') }}
          </button>
          <button class="secondary-btn" @click="startAddServer">
            {{ t('settings.mcp.addServer') }}
          </button>
        </div>
      </div>

      <div v-if="serversLoading" class="empty-state">{{ t('settings.mcp.loadingServers') }}</div>
      <div v-else-if="serversError" class="error-text">{{ serversError }}</div>
      <div v-else-if="servers.length === 0" class="empty-state">{{ t('settings.mcp.empty') }}</div>
      <div v-else class="server-list">
        <div v-for="server in servers" :key="server.id" class="server-row">
          <div class="server-main">
            <div class="server-title">
              <span class="server-name">{{ server.name }}</span>
              <span class="server-transport">{{ formatTransport(server.transport) }}</span>
              <span class="server-status" :class="statusClass(server)">
                {{ statusLabel(server) }}
              </span>
            </div>
            <div class="server-meta">
              <span v-if="server.transport === 'stdio' && server.command">
                {{ t('settings.mcp.meta.command', { value: server.command }) }}
              </span>
              <span
                v-else-if="
                  (server.transport === 'streamable-http' || server.transport === 'sse') &&
                  server.base_url
                "
              >
                {{ t('settings.mcp.meta.url', { value: server.base_url }) }}
              </span>
            </div>
            <div class="server-meta">
              <span>{{
                t('settings.mcp.meta.enabled', { value: server.enabled ? t('common.yes') : t('common.no') })
              }}</span>
              <span v-if="server.status?.toolCount !== undefined">
                {{ t('settings.mcp.meta.tools', { count: server.status.toolCount }) }}
              </span>
              <span v-if="server.last_connected_at">
                {{ t('settings.mcp.meta.lastConnected', { value: formatTimestamp(server.last_connected_at) }) }}
              </span>
            </div>
            <div v-if="server.last_error" class="error-text server-error">
              {{ server.last_error }}
            </div>
          </div>
          <div class="server-actions">
            <button
              class="secondary-btn"
              :disabled="!canConnect(server)"
              @click="connectServer(server)"
            >
              {{ t('settings.mcp.connect') }}
            </button>
            <button
              class="secondary-btn"
              :disabled="!canDisconnect(server)"
              @click="disconnectServer(server)"
            >
              {{ t('settings.mcp.disconnect') }}
            </button>
            <button
              class="secondary-btn"
              :disabled="!canRefresh(server)"
              @click="refreshTools(server)"
            >
              {{ t('settings.mcp.refreshTools') }}
            </button>
            <button
              class="secondary-btn"
              :disabled="actionLoading"
              @click="startEditServer(server)"
            >
              {{ t('settings.mcp.editServer') }}
            </button>
            <button class="danger-btn" :disabled="actionLoading" @click="deleteServer(server)">
              {{ t('settings.mcp.deleteServer') }}
            </button>
          </div>
        </div>
      </div>

      <div v-if="actionError" class="error-text">{{ actionError }}</div>
    </div>

    <div v-if="formOpen" class="settings-card">
      <div class="card-header">
        <div class="card-title">
          {{ editingServerId ? t('settings.mcp.form.editTitle') : t('settings.mcp.form.addTitle') }}
        </div>
        <div class="card-actions">
          <button class="secondary-btn" @click="cancelForm">{{ t('common.cancel') }}</button>
        </div>
      </div>

      <div class="config-grid">
        <label class="input-label">
          <span>{{ t('common.name') }}</span>
          <input
            v-model="form.name"
            type="text"
            :placeholder="t('settings.mcp.form.namePlaceholder')"
          />
        </label>
        <label class="input-label">
          <span>{{ t('settings.mcp.form.transport') }}</span>
          <SettingsSelect
            :model-value="form.transport"
            :options="mcpTransportOptions"
            :aria-label="t('settings.mcp.form.transportAria')"
            @update:model-value="updateFormTransportSelection"
          />
        </label>
        <label class="checkbox-label">
          <input type="checkbox" v-model="form.enabled" />
          {{ t('common.enabled') }}
        </label>
        <label class="input-label">
          <span>{{ t('settings.mcp.form.approvalOverride') }}</span>
          <SettingsSelect
            :model-value="form.approvalMode"
            :options="mcpApprovalOverrideOptions"
            :aria-label="t('settings.mcp.form.approvalOverrideAria')"
            @update:model-value="updateFormApprovalModeSelection"
          />
        </label>
        <label class="input-label">
          <span>{{ t('settings.mcp.form.toolAllowlist') }}</span>
          <textarea
            v-model="form.toolAllowlist"
            rows="4"
            :placeholder="t('settings.mcp.form.toolAllowlistPlaceholder')"
          />
        </label>
      </div>

      <p v-if="form.transport === 'streamable-http'" class="group-description">
        {{ t('settings.mcp.form.streamableHint') }}
      </p>
      <p v-else-if="form.transport === 'sse'" class="group-description warning-text">
        {{ t('settings.mcp.form.sseHint') }}
      </p>

      <template v-if="form.transport === 'stdio'">
        <div class="config-grid">
          <label class="input-label">
            <span>{{ t('settings.mcp.form.command') }}</span>
            <input
              v-model="form.command"
              type="text"
              :placeholder="t('settings.mcp.form.commandPlaceholder')"
            />
          </label>
          <label class="input-label">
            <span>{{ t('settings.mcp.form.workingDirectoryOptional') }}</span>
            <input
              v-model="form.cwd"
              type="text"
              :placeholder="t('settings.mcp.form.workingDirectoryPlaceholder')"
            />
          </label>
          <label class="input-label">
            <span>{{ t('settings.mcp.form.args') }}</span>
            <textarea
              v-model="form.args"
              rows="4"
              :placeholder="t('settings.mcp.form.argsPlaceholder')"
            />
          </label>
          <label class="input-label">
            <span>{{ t('settings.mcp.form.environment') }}</span>
            <textarea
              v-model="form.env"
              rows="4"
              :placeholder="t('settings.mcp.form.environmentPlaceholder')"
            />
          </label>
        </div>
      </template>

      <template v-else>
        <div class="config-grid">
          <label class="input-label">
            <span>{{ t('settings.mcp.form.baseUrl') }}</span>
            <input
              v-model="form.baseUrl"
              type="text"
              :placeholder="t('settings.mcp.form.baseUrlPlaceholder')"
            />
          </label>
          <label class="input-label">
            <span>{{ t('settings.mcp.form.authRefOptional') }}</span>
            <input
              v-model="form.authRef"
              type="text"
              :placeholder="t('settings.mcp.form.authRefPlaceholder')"
            />
          </label>
          <label class="input-label">
            <span>{{ t('settings.mcp.form.headers') }}</span>
            <textarea
              v-model="form.headers"
              rows="4"
              :placeholder="t('settings.mcp.form.headersPlaceholder')"
            />
          </label>
        </div>
        <p v-if="!config.mcp.allowRemoteServers" class="group-description warning-text">
          {{ t('settings.mcp.form.remoteDisabled') }}
        </p>
      </template>

      <div class="form-actions">
        <button class="secondary-btn" @click="cancelForm">{{ t('common.cancel') }}</button>
        <button class="primary-btn" :disabled="formSaving" @click="saveServer">
          {{ formSaving ? t('settings.mcp.form.saving') : t('settings.mcp.form.save') }}
        </button>
      </div>
      <div v-if="formError" class="error-text">{{ formError }}</div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { RefreshCw } from 'lucide-vue-next';

import SettingsSelect from './SettingsSelect.vue';
import { useI18n } from '../../i18n';
import { useMcpSettings } from '../../composables/useMcpSettings';

const emit = defineEmits<{
  (event: 'config-change'): void;
}>();

const { t } = useI18n();

const {
  actionError,
  actionLoading,
  canConnect,
  canDisconnect,
  canRefresh,
  cancelForm,
  config,
  connectServer,
  deleteServer,
  disconnectServer,
  editingServerId,
  form,
  formError,
  formOpen,
  formSaving,
  formatTimestamp,
  formatTransport,
  loadServers,
  mcpApprovalOverrideOptions,
  mcpDefaultApprovalModeOptions,
  mcpTransportOptions,
  refreshTools,
  saveServer,
  servers,
  serversError,
  serversLoading,
  startAddServer,
  startEditServer,
  statusClass,
  statusLabel,
  updateDefaultApprovalModeSelection,
  updateFormApprovalModeSelection,
  updateFormTransportSelection,
  updateMcp,
} = useMcpSettings(() => emit('config-change'));
</script>

<style scoped src="./settings_shared.css"></style>
<style scoped src="./settings_mcp.css"></style>
