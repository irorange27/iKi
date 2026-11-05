/**
 * Provider configuration is a declaration, not a table.
 *
 * One `models.toml`, providers keyed by id, structured values. TOML tables keep
 * it pleasant to edit by hand (`[providers.<id>]`); the document is still
 * validated and frozen by the domain contract (`@iki/core/domain/models`) on
 * every read — the file is the source of truth, so an edit made by another
 * process or by hand is visible on the next request without a cache to
 * invalidate. TOML has no null, so optional fields are expressed by omission.
 */
import fs from 'node:fs';
import path from 'node:path';

import { parse, stringify, TomlError } from 'smol-toml';

import {
  loadModelsConfig,
  toProvider,
  type ModelsConfig,
  type Provider,
  type ProviderConfig,
} from '@iki/core/domain/models';
import { storeRoot } from './collection';

const CONFIG_FILE = 'models.toml';

export type ProviderDeclaration = Pick<ProviderConfig, 'name' | 'type' | 'api_key'> &
  Partial<Omit<ProviderConfig, 'name' | 'type' | 'api_key'>> & { id: string };

const configPath = (): string => path.join(storeRoot(), CONFIG_FILE);

const readConfig = (): ModelsConfig => {
  let raw: string;
  try {
    raw = fs.readFileSync(configPath(), 'utf8');
  } catch (error) {
    // A missing file is an empty configuration; the next write creates it.
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return loadModelsConfig(undefined);
    throw error;
  }
  try {
    return loadModelsConfig(parse(raw));
  } catch (error) {
    // A torn file is an empty configuration; the next write repairs it.
    if (error instanceof TomlError) return loadModelsConfig(undefined);
    throw error;
  }
};

const writeConfig = (config: ModelsConfig): void => {
  const file = configPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // smol-toml omits null/undefined members, which is how the schema's nullable
  // capability overrides become "unset" in a format that has no null.
  fs.writeFileSync(file, stringify(config));
};

export const getProviders = (): Provider[] =>
  Object.entries(readConfig().providers).map(([id, stored]) => toProvider(id, stored));

export const getProvider = (id: string): Provider | null => {
  const stored = readConfig().providers[id];
  return stored ? toProvider(id, stored) : null;
};

export const addProvider = (provider: ProviderDeclaration): Provider => {
  const config = readConfig();
  const declaration: ProviderConfig = {
    name: provider.name,
    type: provider.type,
    api_key: provider.api_key,
    base_url: provider.base_url ?? '',
    enabled: provider.enabled ?? false,
    models: provider.models ?? [],
    available_models: provider.available_models ?? [],
    model_options: provider.model_options ?? {},
    ...(provider.is_response_api === true ? { is_response_api: true } : {}),
  };
  writeConfig({ providers: { ...config.providers, [provider.id]: declaration } });
  return getProvider(provider.id)!;
};

/** Merge a partial update into one declaration; `id` is immutable. */
export const updateProvider = (id: string, patch: Partial<Provider>): Provider | null => {
  const { id: _ignored, ...changes } = patch;
  void _ignored;
  if (Object.keys(changes).length === 0) return null;

  const config = readConfig();
  const current = config.providers[id];
  if (!current) return null;

  writeConfig({
    providers: { ...config.providers, [id]: { ...current, ...changes } },
  });
  return getProvider(id)!;
};

export const deleteProvider = (id: string): void => {
  const config = readConfig();
  if (!(id in config.providers)) return;
  const { [id]: _removed, ...providers } = config.providers;
  void _removed;
  writeConfig({ providers });
};
