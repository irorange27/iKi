export type AgentContext = Record<string, unknown>;

export interface TaskAgent<I, O, C = AgentContext> {
  run(input: I, context?: C): Promise<O>;
}
