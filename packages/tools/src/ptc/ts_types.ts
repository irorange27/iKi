export type PtcMcpToolDescriptor = {
  name: string;
  safeName: string;
  internalName?: string;
  description?: string;
  inputSchema?: unknown;
  outputSchema?: unknown;
};

export type PtcMcpServerDescriptor = {
  id: string;
  name: string;
  safeName: string;
  tools: PtcMcpToolDescriptor[];
};

const JS_IDENT_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

export const sanitizeJsIdentifier = (raw: string, fallback = 'item'): string => {
  const cleaned = raw
    .trim()
    .replace(/[^A-Za-z0-9_$]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!cleaned) return fallback;
  return /^[0-9]/.test(cleaned) ? `_${cleaned}` : cleaned;
};

const formatPropKey = (key: string): string =>
  JS_IDENT_RE.test(key) ? key : JSON.stringify(key);

const formatLiteral = (value: unknown): string => {
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return String(value);
  return 'unknown';
};

/**
 * Compiles a JSON Schema object into a compact single-line TypeScript type expression.
 * Designed to give LLMs 5-10x denser, more idiomatic parameter signatures than raw JSON Schema.
 */
export const jsonSchemaToTsType = (schema: unknown, depth = 0): string => {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return 'unknown';
  if (depth >= 4) return 'unknown';
  const s = schema as Record<string, unknown>;

  if ('const' in s) return formatLiteral(s.const);
  if (Array.isArray(s.enum) && s.enum.length > 0) {
    return s.enum.slice(0, 16).map(formatLiteral).join(' | ');
  }
  if (Array.isArray(s.anyOf) && s.anyOf.length > 0) {
    return s.anyOf.slice(0, 8).map(part => jsonSchemaToTsType(part, depth + 1)).join(' | ');
  }
  if (Array.isArray(s.oneOf) && s.oneOf.length > 0) {
    return s.oneOf.slice(0, 8).map(part => jsonSchemaToTsType(part, depth + 1)).join(' | ');
  }

  const rawType = s.type;
  if (Array.isArray(rawType)) {
    return rawType
      .map(t => jsonSchemaToTsType({ ...s, type: t }, depth + 1))
      .join(' | ');
  }

  if (rawType === 'string') return 'string';
  if (rawType === 'number' || rawType === 'integer') return 'number';
  if (rawType === 'boolean') return 'boolean';
  if (rawType === 'null') return 'null';

  if (rawType === 'array') {
    const itemType = s.items ? jsonSchemaToTsType(s.items, depth + 1) : 'unknown';
    return itemType.includes(' | ') ? `Array<${itemType}>` : `${itemType}[]`;
  }

  if (rawType === 'object' || (s.properties && typeof s.properties === 'object')) {
    const props =
      s.properties && typeof s.properties === 'object' && !Array.isArray(s.properties)
        ? (s.properties as Record<string, unknown>)
        : null;
    if (!props || Object.keys(props).length === 0) {
      if (s.additionalProperties && typeof s.additionalProperties === 'object') {
        return `Record<string, ${jsonSchemaToTsType(s.additionalProperties, depth + 1)}>`;
      }
      return 'Record<string, unknown>';
    }
    const required = new Set(
      Array.isArray(s.required) ? s.required.filter((k): k is string => typeof k === 'string') : []
    );
    const entries = Object.entries(props).slice(0, 24);
    const fields = entries.map(([key, propSchema]) => {
      const opt = required.has(key) ? '' : '?';
      return `${formatPropKey(key)}${opt}: ${jsonSchemaToTsType(propSchema, depth + 1)}`;
    });
    if (Object.keys(props).length > entries.length) {
      fields.push('[key: string]: unknown');
    }
    return `{ ${fields.join('; ')} }`;
  }

  return 'unknown';
};

const clipComment = (text?: string, max = 120): string => {
  if (!text) return '';
  const single = text.replace(/\s+/g, ' ').replace(/\*\//g, '* /').trim();
  return single.length > max ? `${single.slice(0, max - 3)}...` : single;
};

const formatToolSignature = (tool: PtcMcpToolDescriptor): string => {
  const argsType = jsonSchemaToTsType(tool.inputSchema);
  const needsArgs = argsType !== 'Record<string, unknown>' && argsType !== 'unknown';
  const param = needsArgs ? `args: ${argsType}` : 'args?: Record<string, unknown>';
  return `${tool.safeName}(${param}): Promise<McpResult>`;
};

/** Compact inline signature for small MCP catalogs (L0 progressive disclosure). */
export const formatMcpToolCompactSignature = (tool: PtcMcpToolDescriptor): string => {
  const argsType = jsonSchemaToTsType(tool.inputSchema);
  const needsArgs = argsType !== 'Record<string, unknown>' && argsType !== 'unknown';
  return needsArgs ? `${tool.safeName}(${argsType})` : `${tool.safeName}()`;
};

/**
 * Generates compact TypeScript `declare namespace mcp.<server>` declarations (L1 disclosure).
 */
export const renderMcpNamespaceDts = (
  servers: readonly PtcMcpServerDescriptor[],
  filter?: { server?: string; tool?: string }
): string => {
  const serverKey = filter?.server?.trim().toLowerCase();
  const toolKey = filter?.tool?.trim().toLowerCase();

  const matchedServers = serverKey
    ? servers.filter(
        s =>
          s.safeName.toLowerCase() === serverKey ||
          s.name.toLowerCase() === serverKey ||
          s.id.toLowerCase() === serverKey
      )
    : [...servers];

  if (matchedServers.length === 0) {
    const names = servers.map(s => s.safeName).join(', ');
    return serverKey
      ? `// No connected MCP server matching "${filter?.server}". Connected: ${names || '(none)'}`
      : '// No MCP servers connected.';
  }

  const lines: string[] = [
    'type McpResult<T = any> = { content: unknown[]; text?: string; data?: T; isError?: boolean };',
  ];

  for (const server of matchedServers) {
    const matchedTools = toolKey
      ? server.tools.filter(
          t =>
            t.safeName.toLowerCase() === toolKey ||
            t.name.toLowerCase() === toolKey ||
            (t.internalName?.toLowerCase() === toolKey)
        )
      : server.tools;

    lines.push(`declare namespace mcp.${server.safeName} {`);
    if (matchedTools.length === 0) {
      lines.push(`  // No matching tools in "${server.name}".`);
    } else {
      for (const tool of matchedTools) {
        const desc = clipComment(tool.description);
        if (desc) lines.push(`  /** ${desc} */`);
        lines.push(`  function ${formatToolSignature(tool)};`);
      }
    }
    lines.push('}');
  }

  return lines.join('\n');
};
