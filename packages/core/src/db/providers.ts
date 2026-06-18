import { getDb } from './database';
import { Provider } from '../types/provider';
import { buildSetClause } from './utils';

type ProviderRow = Provider & { enabled: number | boolean; is_response_api?: number | boolean };

export const getProviders = (): Provider[] => {
  const rows = getDb().prepare('SELECT * FROM providers').all() as ProviderRow[];
  return rows.map(row => ({
    ...row,
    enabled: Boolean(row.enabled),
    is_response_api: Boolean(row.is_response_api),
  }));
};

export const getProvider = (id: string): Provider | null => {
  const row = getDb()
    .prepare('SELECT * FROM providers WHERE id = ?')
    .get(id) as ProviderRow | undefined;
  if (!row) return null;
  return {
    ...row,
    enabled: Boolean(row.enabled),
    is_response_api: Boolean(row.is_response_api),
  };
};

export const getProviderIsEnabled = (id: string): { enabled: boolean } | null => {
  const provider = getDb().prepare('SELECT enabled FROM providers WHERE id = ?').get(id) as
    | { enabled: number | boolean }
    | undefined;
  if (!provider) return null;
  return {
    enabled: Boolean(provider.enabled),
  };
};

export const addProvider = (
  provider: Partial<Provider> & {
    id: string;
    name: string;
    type: string;
    api_key: string;
    models: string;
  }
) => {
  const now = new Date().toISOString();
  const stmt = getDb().prepare(`
    INSERT INTO providers (
      id, name, type, api_key, models, model_options, base_url, enabled, created_at, updated_at,
      available_models, api_version, is_response_api, acp_command, acp_args,
      acp_mcp_server_ids, acp_auth_method_id, acp_api_provider_id, acp_model_mapping
    ) VALUES (
      @id, @name, @type, @api_key, @models, @model_options, @base_url, @enabled, @created_at, @updated_at,
      @available_models, @api_version, @is_response_api, @acp_command, @acp_args,
      @acp_mcp_server_ids, @acp_auth_method_id, @acp_api_provider_id, @acp_model_mapping
    )
  `);

  // Provide default values for all optional fields
  const data = {
    id: provider.id,
    name: provider.name,
    type: provider.type,
    api_key: provider.api_key,
    models: provider.models,
    model_options: provider.model_options || '{}',
    base_url: provider.base_url || '',
    enabled: provider.enabled ? 1 : 0,
    created_at: now,
    updated_at: now,
    available_models: provider.available_models || '[]',
    api_version: provider.api_version || null,
    is_response_api: provider.is_response_api ? 1 : 0,
    acp_command: provider.acp_command || null,
    acp_args: provider.acp_args || null,
    acp_mcp_server_ids: provider.acp_mcp_server_ids || null,
    acp_auth_method_id: provider.acp_auth_method_id || null,
    acp_api_provider_id: provider.acp_api_provider_id || null,
    acp_model_mapping: provider.acp_model_mapping || null,
  };

  return stmt.run(data);
};

const PROVIDER_COLUMNS = new Set([
  'name', 'type', 'api_key', 'models', 'model_options', 'base_url', 'enabled',
  'available_models', 'api_version', 'is_response_api', 'acp_command', 'acp_args',
  'acp_mcp_server_ids', 'acp_auth_method_id', 'acp_api_provider_id', 'acp_model_mapping',
]);

export const updateProvider = (id: string, provider: Partial<Provider>) => {
  const now = new Date().toISOString();
  const fields = buildSetClause(provider as Record<string, unknown>, PROVIDER_COLUMNS);

  if (!fields) return null;

  const stmt = getDb().prepare(`
    UPDATE providers 
    SET ${fields}, updated_at = @updated_at 
    WHERE id = @id
  `);

  const params: Record<string, unknown> & { id: string; updated_at: string } = {
    ...provider,
    id,
    updated_at: now,
  };
  if (typeof params.enabled === 'boolean') params.enabled = params.enabled ? 1 : 0;
  if (typeof params.is_response_api === 'boolean') {
    params.is_response_api = params.is_response_api ? 1 : 0;
  }

  return stmt.run(params);
};

export const deleteProvider = (id: string) => {
  return getDb().prepare('DELETE FROM providers WHERE id = ?').run(id);
};
