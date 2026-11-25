import type { ThreadMcpSnapshot, ThreadSkillReminderAnchor } from '@iki/core/types/chat';
import { getChatThread, updateChatThread } from '@iki/store/chat_thread';
import { formatPromptContextSnapshot } from '@iki/system-prompt/assembler';
import {
  formatMcpToolCompactSignature,
  type PtcMcpServerDescriptor,
} from '@iki/tools/ptc';
import { getMcpManager } from './index';

const INLINE_SIGNATURE_MAX_TOOLS = 6;
const INLINE_SIGNATURE_MAX_CHARS = 480;

const clipDesc = (text?: string, max = 72): string => {
  if (!text) return '';
  const single = text.replace(/\s+/g, ' ').trim();
  return single.length > max ? `${single.slice(0, max - 3)}...` : single;
};

const fingerprintServer = (server: PtcMcpServerDescriptor): string =>
  JSON.stringify({
    name: server.name,
    safeName: server.safeName,
    tools: server.tools.map(t => ({
      name: t.name,
      safeName: t.safeName,
      sig: formatMcpToolCompactSignature(t),
      desc: clipDesc(t.description, 80),
    })),
  });

const formatServerSummaryLines = (server: PtcMcpServerDescriptor): string[] => {
  if (server.tools.length === 0) {
    return [`- ${server.safeName} (0 tools)`];
  }
  if (server.tools.length <= INLINE_SIGNATURE_MAX_TOOLS) {
    const inlineLines = server.tools.map(tool => {
      const sig = formatMcpToolCompactSignature(tool);
      const desc = clipDesc(tool.description, 64);
      return `  - mcp.${server.safeName}.${sig}${desc ? ` — ${desc}` : ''}`;
    });
    const totalLen = inlineLines.reduce((acc, l) => acc + l.length, 0);
    if (totalLen <= INLINE_SIGNATURE_MAX_CHARS) {
      return [`- ${server.safeName} (${server.tools.length} tool${server.tools.length === 1 ? '' : 's'}):`, ...inlineLines];
    }
  }
  const names = server.tools.slice(0, 24).map(t => t.safeName).join(', ');
  const more = server.tools.length > 24 ? `, ... (+${server.tools.length - 24} more)` : '';
  return [
    `- ${server.safeName} (${server.tools.length} tools): ${names}${more} — run \`mcp.describe("${server.safeName}")\` in \`ptc\` for TypeScript signatures`,
  ];
};

export const buildMcpDeltaReminderText = (params: {
  added: PtcMcpServerDescriptor[];
  modified: PtcMcpServerDescriptor[];
  removedNames: string[];
}): string => {
  const { added, modified, removedNames } = params;
  if (added.length === 0 && modified.length === 0 && removedNames.length === 0) return '';

  const lines: string[] = [
    'MCP servers are exposed in Code Mode (system prompt and top-level tool schemas stay frozen for KV-cache stability).',
    'Use `ptc` to call them as TypeScript APIs: `await mcp.<server>.<tool>(args)` (returns `{ content, text, data? }`). Inspect full TS signatures on demand with `mcp.describe(server, tool?)`.',
  ];

  if (added.length > 0) {
    lines.push('Available / newly connected MCP servers:');
    for (const server of added) {
      lines.push(...formatServerSummaryLines(server));
    }
  }

  if (modified.length > 0) {
    lines.push('Updated MCP server tool catalogs:');
    for (const server of modified) {
      lines.push(...formatServerSummaryLines(server));
    }
  }

  if (removedNames.length > 0) {
    lines.push(`Disconnected MCP servers: ${removedNames.join(', ')}`);
  }

  return formatPromptContextSnapshot([
    {
      name: 'mcp',
      order: 25,
      text: lines.join('\n'),
    },
  ]);
};

export const resolveMcpAnchoredReminders = (params: {
  threadId?: string;
  mcpServerIds?: string[];
  currentUserAnchor?: string;
  catalogOverride?: PtcMcpServerDescriptor[];
}): ThreadSkillReminderAnchor[] => {
  const servers =
    params.catalogOverride ??
    getMcpManager().listConnectedServerCatalog(params.mcpServerIds);
  const currentFingerprints: Record<string, string> = {};
  for (const server of servers) {
    currentFingerprints[server.safeName] = fingerprintServer(server);
  }

  const threadId = params.threadId?.trim();
  const thread = threadId ? getChatThread(threadId) : null;
  const previousSnapshot: ThreadMcpSnapshot | null = thread?.mcp_snapshot ?? null;
  const previousMap = previousSnapshot?.lastDelivered ?? {};

  const added: PtcMcpServerDescriptor[] = [];
  const modified: PtcMcpServerDescriptor[] = [];
  const currentNames = new Set<string>();

  for (const server of servers) {
    currentNames.add(server.safeName);
    const prev = previousMap[server.safeName];
    const next = currentFingerprints[server.safeName];
    if (prev === undefined) added.push(server);
    else if (prev !== next) modified.push(server);
  }

  const removedNames = Object.keys(previousMap)
    .filter(name => !currentNames.has(name))
    .sort();

  const existingAnchors = previousSnapshot?.anchoredReminders ?? [];
  const reminderText = buildMcpDeltaReminderText({ added, modified, removedNames });
  if (!reminderText) {
    return existingAnchors;
  }

  const anchor = params.currentUserAnchor?.trim();
  if (!anchor) {
    return existingAnchors;
  }

  const nextAnchors: ThreadSkillReminderAnchor[] = [
    ...existingAnchors,
    { beforeAnchor: anchor, text: reminderText },
  ];

  if (thread) {
    updateChatThread(thread.id, {
      mcp_snapshot: {
        lastDelivered: currentFingerprints,
        anchoredReminders: nextAnchors,
      },
    });
  }

  return nextAnchors;
};
