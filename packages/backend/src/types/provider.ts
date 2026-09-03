export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export interface ProviderModelOptions {
  displayName?: string;
  contextWindow?: number | null;
  maxInputTokens?: number | null;
  maxOutputTokens?: number | null;
  supportsToolCalls?: boolean | null;
  supportsReasoning?: boolean | null;
  supportsVision?: boolean | null;
  supportsEmbeddings?: boolean | null;
  supportsStructuredOutputs?: boolean | null;
  providerOptions?: Record<string, JsonValue> | null;
}

export type ProviderModelOptionsMap = Record<string, ProviderModelOptions>;

export interface ProviderModelDescriptor extends ProviderModelOptions {
  id: string;
  source?: 'models.dev' | 'provider';
}

export type ModelCapabilitySnapshot = Pick<
  ProviderModelOptions,
  'contextWindow' | 'maxInputTokens' | 'maxOutputTokens' | 'supportsVision'
>;

export interface Provider {
  id: string;
  name: string;
  type: string;
  api_key: string;
  models: string; // JSON string of models
  model_options?: string; // JSON string keyed by model id
  base_url?: string;
  enabled: boolean;
  created_at: string;
  updated_at: string;
  available_models: string; // JSON string
  api_version?: string;
  is_response_api?: boolean;
  acp_command?: string;
  acp_args?: string;
  acp_mcp_server_ids?: string;
  acp_auth_method_id?: string;
  acp_api_provider_id?: string;
  acp_model_mapping?: string;
}

export type ProviderModelDiscoveryOverride = Partial<
  Pick<
    Provider,
    | 'id'
    | 'type'
    | 'api_key'
    | 'base_url'
    | 'models'
    | 'model_options'
    | 'is_response_api'
    | 'acp_command'
    | 'acp_args'
    | 'acp_mcp_server_ids'
    | 'acp_auth_method_id'
    | 'acp_api_provider_id'
    | 'acp_model_mapping'
  >
>;

export type ProviderUpdatedAction = 'added' | 'updated' | 'deleted';

export interface ProviderUpdatedEvent {
  action: ProviderUpdatedAction;
  providerId: string;
}
