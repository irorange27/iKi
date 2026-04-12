import type { ProviderRecord } from '../../../composables/useProviderDrafts';

export type EditableProvider = Pick<
  ProviderRecord,
  'id' | 'name' | 'type' | 'api_key' | 'base_url' | 'enabled' | 'icon' | 'is_response_api'
> & {
  models: string;
  available_models: string;
};

export type ProviderSelectOption = {
  value: string;
  label: string;
};

export type EditableProviderApiFormat = {
  value: 'chat-completions' | 'responses' | 'messages';
  options: Array<{ value: 'chat-completions' | 'responses' | 'messages'; label: string }>;
  endpoint: string;
  description: string;
  note: string;
  locked: boolean;
};

export type SidebarProvider = {
  id: string;
  name: string;
  isCustom: boolean;
  icon?: string | null;
  enabled: boolean;
  searchText: string;
};

export type ActiveModelOptionsEditor = {
  providerId: string;
  modelId: string;
};

export type AcpMcpServerEntry = {
  id: string;
  name: string;
  meta: string;
  enabled: boolean;
  missing: boolean;
};

export type ProviderSupportLink = {
  prefix: string;
  url: string;
  label: string;
};

export const arrayEquals = (left: string[], right: string[]) =>
  left.length === right.length && left.every((value, index) => value === right[index]);

export const normalizeSelectedAcpMcpServerIds = (value: string[]): string[] => {
  const seen = new Set<string>();

  return value
    .map(entry => entry.trim())
    .filter(entry => {
      if (!entry || seen.has(entry)) {
        return false;
      }

      seen.add(entry);
      return true;
    });
};

const sortNormalizedStringList = (value: string[]) => [...normalizeSelectedAcpMcpServerIds(value)].sort();

export const arraySetEquals = (left: string[], right: string[]) =>
  arrayEquals(sortNormalizedStringList(left), sortNormalizedStringList(right));
