import fs from 'node:fs';
import path from 'node:path';

import {
  createACPProvider,
  type ACPProvider,
  type ACPProviderSettings,
} from '@mcpc-tech/acp-ai-provider';
import type { LanguageModel } from 'ai';

import { listMcpServers } from '../../context/mcp_server_store';
import { getProvider } from '../../context/provider_store';
import { createLogger } from '../../logger';
import { getUserDataPath } from '../../context/platform_provider';
import { ensureThreadWorkspaceSelection } from '../../context/workspace_provider';
import { ACP_PROVIDER_TYPE } from '../../constants/acp';
import type { ProviderModelDescriptor } from '../../types/provider';
import type { McpServer as IkiMcpServer } from '../../types/mcp';

const acpProviderLogger = createLogger({ module: 'acp_provider' });
const ACP_SESSION_DIR = 'acp-session';

export type AcpProviderConfig = {
  id: string;
  apiKey: string;
  baseURL: string;
  acpCommand?: string | null;
  acpArgs?: string | null;
  acpMcpServerIds?: string | null;
  acpAuthMethodId?: string | null;
  acpApiProviderId?: string | null;
  acpModelMapping?: string | null;
};

type AcpModelMappingEntry = {
  modelId: string;
  modeId?: string;
  displayName?: string;
};

type AcpModelTarget = AcpModelMappingEntry & {
  requestedModelId: string;
};

type AcpSessionMcpServer = ACPProviderSettings['session']['mcpServers'][number];
type AcpSessionHttpServer = Extract<AcpSessionMcpServer, { type: 'http' }>;
type AcpSessionSseServer = Extract<AcpSessionMcpServer, { type: 'sse' }>;
type AcpSessionStdioServer = Exclude<AcpSessionMcpServer, AcpSessionHttpServer | AcpSessionSseServer>;
type AcpSessionEnvVariable = AcpSessionStdioServer['env'][number];
type AcpSessionHttpHeader = AcpSessionHttpServer['headers'][number];

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const normalizeString = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  return value.trim();
};

const normalizeOptionalString = (value: unknown): string | undefined => {
  const normalized = normalizeString(value);
  return normalized ? normalized : undefined;
};

const normalizeStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];

  return value
    .filter((entry): entry is string => typeof entry === 'string')
    .map(entry => entry.trim())
    .filter(Boolean);
};

const parseSelectedMcpServerIds = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return [...new Set(normalizeStringArray(value))];
  }

  if (typeof value !== 'string') return [];
  const trimmed = value.trim();
  if (!trimmed) return [];

  try {
    const parsed = JSON.parse(trimmed);
    return [...new Set(normalizeStringArray(parsed))];
  } catch {
    return [];
  }
};

export const isAcpProviderType = (providerType: string): boolean =>
  providerType.trim().toLowerCase() === ACP_PROVIDER_TYPE;

export const parseAcpArgs = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return normalizeStringArray(value);
  }

  if (typeof value !== 'string') return [];

  const trimmed = value.trim();
  if (!trimmed) return [];

  if (trimmed.startsWith('[')) {
    try {
      return normalizeStringArray(JSON.parse(trimmed));
    } catch (error) {
      throw new Error(
        `ACP args must be a JSON string array or shell-style arguments: ${
          error instanceof Error ? error.message : 'invalid JSON'
        }`
      );
    }
  }

  const tokenizeLine = (line: string, lineNumber: number): string[] => {
    const tokens: string[] = [];
    let current = '';
    let quote: '"' | "'" | null = null;
    let escaping = false;

    const flushCurrent = () => {
      if (!current) return;
      tokens.push(current);
      current = '';
    };

    for (const char of line) {
      if (escaping) {
        current += char;
        escaping = false;
        continue;
      }

      if (quote === "'") {
        if (char === "'") {
          quote = null;
        } else {
          current += char;
        }
        continue;
      }

      if (quote === '"') {
        if (char === '"') {
          quote = null;
        } else if (char === '\\') {
          escaping = true;
        } else {
          current += char;
        }
        continue;
      }

      if (char === '\\') {
        escaping = true;
        continue;
      }

      if (char === "'" || char === '"') {
        quote = char;
        continue;
      }

      if (/\s/u.test(char)) {
        flushCurrent();
        continue;
      }

      current += char;
    }

    if (escaping) {
      throw new Error(`ACP args line ${lineNumber} ends with an escape character.`);
    }

    if (quote) {
      throw new Error(`ACP args line ${lineNumber} has an unterminated ${quote} quote.`);
    }

    flushCurrent();
    return tokens;
  };

  const lines = trimmed
    .split(/\r?\n/u)
    .map(entry => entry.trim())
    .filter(Boolean);

  if (lines.length > 0) {
    return lines.flatMap((line, index) => tokenizeLine(line, index + 1));
  }

  return tokenizeLine(trimmed, 1);
};

const normalizeAcpModelMappingEntry = (value: unknown): AcpModelMappingEntry | null => {
  if (typeof value === 'string') {
    const modelId = value.trim();
    return modelId ? { modelId } : null;
  }

  if (!isObjectRecord(value)) return null;

  const modelId = normalizeString(value.modelId ?? value.model ?? value.id);
  if (!modelId) return null;

  return {
    modelId,
    ...(normalizeOptionalString(value.modeId ?? value.mode) ? {
      modeId: normalizeOptionalString(value.modeId ?? value.mode),
    } : {}),
    ...(normalizeOptionalString(value.displayName ?? value.name) ? {
      displayName: normalizeOptionalString(value.displayName ?? value.name),
    } : {}),
  };
};

export const parseAcpModelMapping = (
  value: unknown
): Record<string, AcpModelMappingEntry> => {
  if (!value) return {};

  const rawRecord =
    typeof value === 'string'
      ? (() => {
          const trimmed = value.trim();
          if (!trimmed) return null;
          try {
            const parsed = JSON.parse(trimmed);
            return isObjectRecord(parsed) ? parsed : null;
          } catch (error) {
            throw new Error(
              `ACP model mapping must be a JSON object: ${
                error instanceof Error ? error.message : 'invalid JSON'
              }`
            );
          }
        })()
      : isObjectRecord(value)
        ? value
        : null;

  if (!rawRecord) return {};

  const mapping: Record<string, AcpModelMappingEntry> = {};
  for (const [alias, entry] of Object.entries(rawRecord)) {
    const normalizedAlias = alias.trim();
    if (!normalizedAlias) continue;

    const normalizedEntry = normalizeAcpModelMappingEntry(entry);
    if (!normalizedEntry) continue;

    mapping[normalizedAlias] = normalizedEntry;
  }

  return mapping;
};

const resolveAcpModelTarget = (
  requestedModelId: string,
  rawMapping: unknown
): AcpModelTarget => {
  const trimmedRequestedModelId = requestedModelId.trim();
  const mapping = parseAcpModelMapping(rawMapping);
  const mapped = mapping[trimmedRequestedModelId];

  if (!mapped) {
    return {
      requestedModelId: trimmedRequestedModelId,
      modelId: trimmedRequestedModelId,
    };
  }

  return {
    requestedModelId: trimmedRequestedModelId,
    modelId: mapped.modelId,
    ...(mapped.modeId ? { modeId: mapped.modeId } : {}),
    ...(mapped.displayName ? { displayName: mapped.displayName } : {}),
  };
};

const resolveCredentialSource = (providerId?: string | null) => {
  const normalizedProviderId = normalizeString(providerId);
  if (!normalizedProviderId) return null;

  const provider = getProvider(normalizedProviderId);
  if (!provider?.enabled) return null;
  return provider;
};

const buildAcpEnv = (config: AcpProviderConfig): Record<string, string> => {
  const referencedProvider = resolveCredentialSource(config.acpApiProviderId);
  const apiKey = normalizeString(config.apiKey) || normalizeString(referencedProvider?.api_key);
  const baseURL = normalizeString(config.baseURL) || normalizeString(referencedProvider?.base_url);

  const env: Record<string, string> = {};
  // NOTE: ACP providers currently assume an OpenAI-compatible API.
  // Non-OpenAI ACP bridges (Anthropic, etc.) will need additional env-var
  // mappings keyed by the referenced provider type.
  if (apiKey) {
    env.OPENAI_API_KEY = apiKey;
    env.CODEX_API_KEY = apiKey;
  }
  if (baseURL) {
    env.OPENAI_BASE_URL = baseURL;
    env.CODEX_BASE_URL = baseURL;
  }

  return env;
};

const ensureDefaultAcpSessionDirectory = (): string => {
  const sessionDirectory = path.join(getUserDataPath(), ACP_SESSION_DIR);
  fs.mkdirSync(sessionDirectory, { recursive: true });
  return sessionDirectory;
};

export const resolveAcpSessionCwd = (threadId?: string): string => {
  const threadWorkspacePath = ensureThreadWorkspaceSelection(threadId)?.workspace?.path?.trim();
  if (threadWorkspacePath) {
    fs.mkdirSync(threadWorkspacePath, { recursive: true });
    return threadWorkspacePath;
  }

  return ensureDefaultAcpSessionDirectory();
};

const toAcpEnvVariables = (
  env: Record<string, string> | null | undefined
): AcpSessionEnvVariable[] =>
  Object.entries(env ?? {})
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, value]) => ({ name, value }));

const toAcpHttpHeaders = (
  headers: Record<string, string> | null | undefined
): AcpSessionHttpHeader[] =>
  Object.entries(headers ?? {})
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, value]) => ({ name, value }));

const mapMcpServerToAcpSessionServer = (server: IkiMcpServer): AcpSessionMcpServer | null => {
  const name = normalizeString(server.name) || server.id;

  if (server.transport === 'stdio') {
    const command = normalizeString(server.command);
    if (!command) {
      acpProviderLogger.event({
        level: 'warn',
        event: 'acp.mcp_server.invalid',
        outcome: 'degraded',
        message: `Skipping MCP server "${server.id}" because it does not have a command.`,
      });
      return null;
    }

    return {
      name,
      command,
      args: normalizeStringArray(server.args ?? []),
      env: toAcpEnvVariables(server.env),
    };
  }

  const url = normalizeString(server.base_url);
  if (!url) {
    acpProviderLogger.event({
      level: 'warn',
      event: 'acp.mcp_server.invalid',
      outcome: 'degraded',
      message: `Skipping MCP server "${server.id}" because it does not have a URL.`,
    });
    return null;
  }

  if (server.transport === 'streamable-http') {
    return {
      type: 'http',
      name,
      url,
      headers: toAcpHttpHeaders(server.headers),
    };
  }

  if (server.transport === 'sse') {
    return {
      type: 'sse',
      name,
      url,
      headers: toAcpHttpHeaders(server.headers),
    };
  }

  return null;
};

const buildAcpSessionMcpServers = (config: AcpProviderConfig): AcpSessionMcpServer[] => {
  const selectedServerIds = parseSelectedMcpServerIds(config.acpMcpServerIds);
  if (selectedServerIds.length === 0) return [];

  const availableById = new Map(listMcpServers().map(server => [server.id, server]));
  const resolvedServers: AcpSessionMcpServer[] = [];

  for (const serverId of selectedServerIds) {
    const server = availableById.get(serverId);

    if (!server) {
      acpProviderLogger.event({
        level: 'warn',
        event: 'acp.mcp_server.missing',
        outcome: 'degraded',
        message: `Skipping missing MCP server "${serverId}" for ACP provider "${config.id}".`,
      });
      continue;
    }

    if (!server.enabled) {
      acpProviderLogger.event({
        level: 'warn',
        event: 'acp.mcp_server.disabled',
        outcome: 'degraded',
        message: `Skipping disabled MCP server "${serverId}" for ACP provider "${config.id}".`,
      });
      continue;
    }

    const mapped = mapMcpServerToAcpSessionServer(server);
    if (mapped) {
      resolvedServers.push(mapped);
    }
  }

  return resolvedServers;
};

const buildAcpProvider = (config: AcpProviderConfig, threadId?: string): ACPProvider => {
  const command = normalizeString(config.acpCommand);
  if (!command) {
    throw new Error('ACP command is required before the provider can be used.');
  }

  const args = parseAcpArgs(config.acpArgs);
  const env = buildAcpEnv(config);
  const cwd = resolveAcpSessionCwd(threadId);
  const mcpServers = buildAcpSessionMcpServers(config);

  return createACPProvider({
    command,
    ...(args.length > 0 ? { args } : {}),
    ...(Object.keys(env).length > 0 ? { env } : {}),
    ...(normalizeOptionalString(config.acpAuthMethodId)
      ? { authMethodId: normalizeOptionalString(config.acpAuthMethodId) }
      : {}),
    session: {
      cwd,
      mcpServers,
    },
    persistSession: true,
  });
};

export const createAcpLanguageModel = (
  config: AcpProviderConfig,
  requestedModelId: string,
  threadId?: string
): LanguageModel => {
  const provider = buildAcpProvider(config, threadId);
  const target = resolveAcpModelTarget(requestedModelId, config.acpModelMapping);
  return provider.languageModel(target.modelId, target.modeId);
};

type AcpModelState = {
  availableModels?: Array<{
    modelId?: string | null;
    name?: string | null;
    description?: string | null;
  }> | null;
  currentModelId?: string | null;
} | null;

const createDescriptorFromModelState = (model: {
  modelId?: string | null;
  name?: string | null;
  description?: string | null;
}): ProviderModelDescriptor | null => {
  const modelId = normalizeString(model.modelId);
  if (!modelId) return null;

  const displayName = normalizeString(model.name) || modelId;

  return {
    id: modelId,
    displayName,
    supportsToolCalls: true,
    source: 'provider',
  };
};

export const fetchAcpModels = async (
  config: AcpProviderConfig,
  threadId?: string
): Promise<ProviderModelDescriptor[]> => {
  const provider = buildAcpProvider(config, threadId);

  try {
    const session = await provider.initSession();
    const modelState = session.models as AcpModelState;
    const descriptors = new Map<string, ProviderModelDescriptor>();

    for (const model of modelState?.availableModels ?? []) {
      const descriptor = createDescriptorFromModelState(model);
      if (!descriptor) continue;
      descriptors.set(descriptor.id, descriptor);
    }

    const currentModelId = normalizeString(modelState?.currentModelId);
    if (currentModelId && !descriptors.has(currentModelId)) {
      descriptors.set(currentModelId, {
        id: currentModelId,
        displayName: currentModelId,
        supportsToolCalls: true,
        source: 'provider',
      });
    }

    const mapping = parseAcpModelMapping(config.acpModelMapping);
    for (const [alias, target] of Object.entries(mapping)) {
      if (descriptors.has(alias)) continue;

      const targetDescriptor = descriptors.get(target.modelId);
      descriptors.set(alias, {
        id: alias,
        displayName: target.displayName?.trim() || targetDescriptor?.displayName || alias,
        contextWindow: targetDescriptor?.contextWindow ?? null,
        maxInputTokens: targetDescriptor?.maxInputTokens ?? null,
        maxOutputTokens: targetDescriptor?.maxOutputTokens ?? null,
        supportsToolCalls: targetDescriptor?.supportsToolCalls ?? true,
        supportsReasoning: targetDescriptor?.supportsReasoning,
        supportsVision: targetDescriptor?.supportsVision,
        source: 'provider',
      });
    }

    return [...descriptors.values()];
  } finally {
    provider.cleanup();
  }
};

export type AcpAuthMethod = {
  id: string;
  name: string;
  description?: string | null;
  type: 'env_var' | 'terminal' | 'agent';
  link?: string | null;
  vars?: Array<{ name: string; description?: string | null; secret?: boolean }>;
};

export const fetchAcpAuthMethods = async (
  config: AcpProviderConfig,
  threadId?: string
): Promise<AcpAuthMethod[]> => {
  const provider = buildAcpProvider(config, threadId);

  try {
    await provider.initSession();

    const model = (provider as unknown as Record<string, unknown>).model as Record<string, unknown> | undefined;
    const authMethodIds: string[] = Array.isArray(model?.availableAuthMethodIds)
      ? (model.availableAuthMethodIds as string[])
      : [];

    if (authMethodIds.length === 0) return [];

    return authMethodIds.map(id => ({
      id,
      name: id,
      type: 'agent' as const,
    }));
  } catch (error) {
    acpProviderLogger.event({
      level: 'warn',
      event: 'acp.auth_methods.fetch',
      outcome: 'failed',
      error,
    });
    return [];
  } finally {
    try {
      provider.cleanup();
    } catch {
      // cleanup is best-effort
    }
  }
};

export const disposeAcpLanguageModel = (model: LanguageModel): void => {
  const maybeAcpModel = model as LanguageModel & {
    provider?: string;
    forceCleanup?: () => void;
  };

  if (maybeAcpModel.provider !== ACP_PROVIDER_TYPE) return;
  if (typeof maybeAcpModel.forceCleanup !== 'function') return;

  try {
    maybeAcpModel.forceCleanup();
  } catch (error) {
    acpProviderLogger.event({
      level: 'warn',
      event: 'acp.cleanup',
      outcome: 'degraded',
      error,
    });
  }
};
