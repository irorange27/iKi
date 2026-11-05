import { commitRows, patchRow, readRows, removeRow } from './collection';
import { Provider } from '@iki/backend/types/provider';

type ProviderRow = Provider & { enabled: number | boolean; is_response_api?: number | boolean };

const normalize = (row: ProviderRow): Provider => ({
  ...row,
  enabled: Boolean(row.enabled),
  is_response_api: Boolean(row.is_response_api),
});

export const getProviders = (): Provider[] => readRows<ProviderRow>('providers').map(normalize);

export const getProvider = (id: string): Provider | null => {
  const row = readRows<ProviderRow>('providers').find(entry => entry.id === id);
  return row ? normalize(row) : null;
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
  const row = {
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
  };
  const rows = readRows<ProviderRow>('providers').filter(entry => entry.id !== provider.id);
  rows.push(row as unknown as ProviderRow);
  commitRows('providers', rows);
  return { changes: 1, lastInsertRowid: 0 };
};

const PROVIDER_COLUMNS = new Set([
  'name', 'type', 'api_key', 'models', 'model_options', 'base_url', 'enabled',
  'available_models', 'api_version', 'is_response_api',
]);

export const updateProvider = (id: string, provider: Partial<Provider>) => {
  const patch = Object.fromEntries(
    Object.entries(provider).filter(([key]) => PROVIDER_COLUMNS.has(key))
  );
  if (Object.keys(patch).length === 0) return null;
  const changes = patchRow<ProviderRow>('providers', 'id', id, patch, PROVIDER_COLUMNS);
  return { changes, lastInsertRowid: 0 };
};

export const deleteProvider = (id: string) => ({
  changes: removeRow<ProviderRow>('providers', 'id', id),
  lastInsertRowid: 0,
});
