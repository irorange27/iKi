import { defaultToolRegistry } from '../../../core/tools';

type ToolResolveMode = 'manual' | 'auto';

const normalizeExplicitTools = (tools: unknown[]): string[] => {
  const resolved: string[] = [];
  const seen = new Set<string>();

  for (const toolName of tools) {
    if (typeof toolName !== 'string') continue;
    const trimmed = toolName.trim();
    if (!trimmed) continue;
    if (seen.has(trimmed)) continue;
    if (!defaultToolRegistry.get(trimmed)) continue;
    seen.add(trimmed);
    resolved.push(trimmed);
  }

  return resolved;
};

const getAllToolNames = (): string[] => defaultToolRegistry.getToolMetadata().map(t => t.name);

export const resolveToolNames = (params: {
  tools?: string[];
}): { explicitTools: string[]; resolvedTools: string[]; mode: ToolResolveMode } => {
  const hasExplicitToolsParam = Array.isArray(params.tools);
  const explicitTools = hasExplicitToolsParam ? normalizeExplicitTools(params.tools) : [];
  const mode: ToolResolveMode = hasExplicitToolsParam ? 'manual' : 'auto';

  // Default behavior: expose all registered tools and let the model decide if/when to call them.
  // Explicit empty array disables tools.
  const resolvedTools = mode === 'manual' ? explicitTools : getAllToolNames();

  return { explicitTools, resolvedTools, mode };
};
