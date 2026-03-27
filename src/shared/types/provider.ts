export interface Provider {
  id: string;
  name: string;
  type: string;
  api_key: string;
  models: string; // JSON string of models
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

export type ProviderUpdatedAction = 'added' | 'updated' | 'deleted';

export interface ProviderUpdatedEvent {
  action: ProviderUpdatedAction;
  providerId: string;
}
