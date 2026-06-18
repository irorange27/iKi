// Built-in providers registry with metadata
export interface BuiltInProvider {
  id: string;
  name: string;
  description: string;
  defaultBaseUrl?: string;
  models?: string[];
  docsUrl?: string;
  credentialsUrl?: string;
  credentialsLabel?: string;
  requiresApiKey?: boolean;
}
