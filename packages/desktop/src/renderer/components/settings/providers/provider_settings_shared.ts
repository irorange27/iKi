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

export type ProviderSupportLink = {
  prefix: string;
  url: string;
  label: string;
};

export const arrayEquals = (left: string[], right: string[]) =>
  left.length === right.length && left.every((value, index) => value === right[index]);
