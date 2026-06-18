import type { McpServer, McpServerInput, McpServerUpdate } from '../types/mcp';

let _listMcpServers: (() => McpServer[]) | null = null;
let _getMcpServer: ((id: string) => McpServer | null) | null = null;
let _addMcpServer: ((input: McpServerInput & { id: string }) => void) | null = null;
let _updateMcpServer: ((id: string, updates: McpServerUpdate) => void) | null = null;
let _deleteMcpServer: ((id: string) => void) | null = null;

export function injectMcpServerStore(fns: {
  listMcpServers: () => McpServer[];
  getMcpServer: (id: string) => McpServer | null;
  addMcpServer: (input: McpServerInput & { id: string }) => void;
  updateMcpServer: (id: string, updates: McpServerUpdate) => void;
  deleteMcpServer: (id: string) => void;
}) {
  _listMcpServers = fns.listMcpServers;
  _getMcpServer = fns.getMcpServer;
  _addMcpServer = fns.addMcpServer;
  _updateMcpServer = fns.updateMcpServer;
  _deleteMcpServer = fns.deleteMcpServer;
}

export function listMcpServers(): McpServer[] {
  if (!_listMcpServers) throw new Error('McpServerStore not injected');
  return _listMcpServers();
}

export function getMcpServer(id: string): McpServer | null {
  if (!_getMcpServer) throw new Error('McpServerStore not injected');
  return _getMcpServer(id);
}

export function addMcpServer(input: McpServerInput & { id: string }): void {
  if (!_addMcpServer) throw new Error('McpServerStore not injected');
  _addMcpServer(input);
}

export function updateMcpServer(id: string, updates: McpServerUpdate): void {
  if (!_updateMcpServer) throw new Error('McpServerStore not injected');
  _updateMcpServer(id, updates);
}

export function deleteMcpServer(id: string): void {
  if (!_deleteMcpServer) throw new Error('McpServerStore not injected');
  _deleteMcpServer(id);
}
