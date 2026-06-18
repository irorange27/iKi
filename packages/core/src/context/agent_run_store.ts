import type { AgentRun, AgentRunCheckpoint, AgentRunStep } from '../types/agent_run';

let _createAgentRun: ((input: Omit<AgentRun, 'createdAt' | 'updatedAt'>) => AgentRun) | null = null;
let _getAgentRun: ((id: string) => AgentRun | null) | null = null;
let _updateAgentRun: ((id: string, updates: Partial<Omit<AgentRun, 'id' | 'createdAt' | 'updatedAt'>>) => AgentRun | null) | null = null;
let _appendAgentRunStep: ((step: AgentRunStep) => AgentRunStep) | null = null;
let _createAgentRunCheckpoint: ((checkpoint: Omit<AgentRunCheckpoint, 'createdAt'> & { createdAt?: string }) => AgentRunCheckpoint) | null = null;

export function injectAgentRunStore(fns: {
  createAgentRun: NonNullable<typeof _createAgentRun>;
  getAgentRun: NonNullable<typeof _getAgentRun>;
  updateAgentRun: NonNullable<typeof _updateAgentRun>;
  appendAgentRunStep: NonNullable<typeof _appendAgentRunStep>;
  createAgentRunCheckpoint: NonNullable<typeof _createAgentRunCheckpoint>;
}) {
  _createAgentRun = fns.createAgentRun;
  _getAgentRun = fns.getAgentRun;
  _updateAgentRun = fns.updateAgentRun;
  _appendAgentRunStep = fns.appendAgentRunStep;
  _createAgentRunCheckpoint = fns.createAgentRunCheckpoint;
}

export function createAgentRun(input: Omit<AgentRun, 'createdAt' | 'updatedAt'>): AgentRun {
  if (!_createAgentRun) throw new Error('AgentRunStore not injected');
  return _createAgentRun(input);
}

export function getAgentRun(id: string): AgentRun | null {
  if (!_getAgentRun) throw new Error('AgentRunStore not injected');
  return _getAgentRun(id);
}

export function updateAgentRun(id: string, updates: Partial<Omit<AgentRun, 'id' | 'createdAt' | 'updatedAt'>>): AgentRun | null {
  if (!_updateAgentRun) throw new Error('AgentRunStore not injected');
  return _updateAgentRun(id, updates);
}

export function appendAgentRunStep(step: AgentRunStep): AgentRunStep {
  if (!_appendAgentRunStep) throw new Error('AgentRunStore not injected');
  return _appendAgentRunStep(step);
}

export function createAgentRunCheckpoint(checkpoint: Omit<AgentRunCheckpoint, 'createdAt'> & { createdAt?: string }): AgentRunCheckpoint {
  if (!_createAgentRunCheckpoint) throw new Error('AgentRunStore not injected');
  return _createAgentRunCheckpoint(checkpoint);
}
