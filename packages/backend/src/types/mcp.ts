export type McpTransport = 'stdio' | 'streamable-http' | 'sse';

export type McpApprovalMode = 'always' | 'safe-only' | 'never';

export type McpServer = {
  id: string;
  name: string;
  transport: McpTransport;
  command?: string | null;
  args?: string[] | null;
  cwd?: string | null;
  env?: Record<string, string> | null;
  base_url?: string | null;
  headers?: Record<string, string> | null;
  auth_ref?: string | null;
  enabled: boolean;
  tool_allowlist?: string[] | null;
  approval_mode?: McpApprovalMode | null;
  created_at: string;
  updated_at: string;
  last_connected_at?: string | null;
  last_error?: string | null;
};

export type McpServerStatus = {
  state: 'connected' | 'disconnected' | 'connecting' | 'error';
  toolCount: number;
  lastError?: string | null;
};

export type McpServerSummary = McpServer & {
  status?: McpServerStatus;
};

export type McpServerInput = {
  name: string;
  transport: McpTransport;
  command?: string | null;
  args?: string[] | null;
  cwd?: string | null;
  env?: Record<string, string> | null;
  base_url?: string | null;
  headers?: Record<string, string> | null;
  auth_ref?: string | null;
  enabled?: boolean;
  tool_allowlist?: string[] | null;
  approval_mode?: McpApprovalMode | null;
};

export type McpServerUpdate = Partial<McpServerInput> & {
  last_connected_at?: string | null;
  last_error?: string | null;
};

export type McpToolAnnotation = {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
};

export type McpToolCatalogItem = {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  annotations?: McpToolAnnotation;
  title?: string;
};
