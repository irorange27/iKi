import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { SlashCommand } from '@earendil-works/pi-tui';
import { getSessionEventRevision } from '@iki/session/session_events';
import { listAgentRunSteps, listAgentRunsByThread } from '@iki/store/agent_runs';
import { getProviders } from '@iki/store/providers';
import {
  getCachedInputTokens,
  getUncachedInputTokens,
  type TokenUsageCounts,
} from '@iki/core/utils/token_usage';
import { getAppConfig } from '@iki/harness/config';
import { getBuiltinToolNames } from '@iki/harness/tools';
import {
  getShellJob,
  killShellJob,
  listShellJobs,
  readBoundedLogSlice,
} from '@iki/tools/shell';
import { getSkillRootsForUi, listSkills } from '@iki/harness/tools/skills';
import { inspectAgentInstructionsForWorkspace } from '@iki/harness/turn_prep/context_blocks';
import {
  deriveThreadTitleFromPrompt,
  isPlaceholderThreadTitle,
} from '@iki/harness/turn_prep/thread_hints';
import {
  rebuildThreadViewFromEvents,
  selectMessagesForCompaction,
} from '@iki/harness/thread_session/session_log';
import type { ChatService } from '@iki/harness/thread_session';
import type { McpManager } from '@iki/harness/mcp';
import type { SwarmManager } from '@iki/harness/swarm';
import { copyLastAssistantReply } from './clipboard';
import {
  executeMcpSlashCommand,
  formatMcpBannerSummary,
  getMcpSlashCompletions,
} from './mcp_commands';
import { executeSwarmSlashCommand } from './swarm_commands';

export type InteractiveCliState = {
  chatService: ChatService;
  swarmManager?: SwarmManager;
  mcpManager?: McpManager;
  dataDir: string;
  threadId: string;
  providerType: string;
  providerId?: string;
  model: string;
  workspace?: string;
  tools?: string[];
  mcpServerIds?: string[];
  skills?: string[];
  skillMode: 'manual' | 'auto';
  initialPrompt?: string;
};

export type UsageTotals = {
  turns: number;
  uncachedInputTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
};

export type TurnTokenUsage = TokenUsageCounts;

export const extractTurnTokenUsage = (data: Record<string, unknown>): TurnTokenUsage => ({
  ...(typeof data.inputTokens === 'number' ? { inputTokens: data.inputTokens } : {}),
  ...(typeof data.cacheReadTokens === 'number' ? { cacheReadTokens: data.cacheReadTokens } : {}),
  ...(typeof data.cacheWriteTokens === 'number'
    ? { cacheWriteTokens: data.cacheWriteTokens }
    : {}),
  ...(typeof data.outputTokens === 'number' ? { outputTokens: data.outputTokens } : {}),
});

export const accumulateUsageTotals = (totals: UsageTotals, usage: TurnTokenUsage): void => {
  totals.uncachedInputTokens += getUncachedInputTokens(usage);
  totals.cacheReadTokens += getCachedInputTokens(usage);
  totals.outputTokens += Math.max(0, usage.outputTokens ?? 0);
};

export const formatTurnUsageBadge = (usage: TurnTokenUsage, elapsedSec: string): string =>
  `[in ${getUncachedInputTokens(usage)} · cache ${getCachedInputTokens(usage)} · out ${Math.max(0, usage.outputTokens ?? 0)} · ${elapsedSec}s]`;

/** Counts persisted user turns and LLM model-inference steps for a thread across runs/restarts. */
export const countThreadTurnsAndSteps = (
  threadId: string,
  messages?: ReadonlyArray<{ role: string }>
): { turns: number; steps: number } => {
  const threadMessages = messages ?? rebuildThreadViewFromEvents(threadId).messages;
  const turns = threadMessages.filter(m => m.role === 'user').length;
  const steps = listAgentRunsByThread(threadId).reduce(
    (total, run) =>
      total + listAgentRunSteps(run.id).filter(step => step.type === 'model').length,
    0
  );
  return { turns, steps };
};

/** Resolves a human-recognizable thread title, falling back to the first user message for legacy placeholder titles. */
export const resolveThreadDisplayTitle = (thread: { id: string; title?: string | null }): string => {
  const rawTitle = thread.title?.trim() ?? '';
  if (rawTitle && !isPlaceholderThreadTitle(rawTitle)) return rawTitle;
  const view = rebuildThreadViewFromEvents(thread.id);
  const firstUser = view.messages.find(m => m.role === 'user');
  if (firstUser) {
    const preview = deriveThreadTitleFromPrompt(readMessagePreview(firstUser.parts));
    if (preview) return preview;
  }
  return rawTitle || 'New Chat';
};

export type EnabledModelOption = {
  providerId: string;
  providerType: string;
  model: string;
  qualified: string;
  active: boolean;
  discovered?: boolean;
};

export const createWorkspaceSelection = (threadId: string, workspacePath: string) => ({
  threadId,
  workspaceId: 'cli-workspace',
  workspace: {
    id: 'cli-workspace',
    name: path.basename(workspacePath) || workspacePath,
    path: workspacePath,
    is_temporary: false,
    show_in_list: false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
});

const clipSingleLine = (text: string, max = 96): string => {
  const single = text.replace(/\s+/g, ' ').trim();
  return single.length > max ? `${single.slice(0, max - 3)}...` : single;
};

const readMessagePreview = (parts: unknown): string => {
  if (!Array.isArray(parts)) return '';
  const text = parts
    .filter(
      (part): part is { type: string; text: string } =>
        Boolean(part) &&
        typeof part === 'object' &&
        (part as { type?: unknown }).type === 'text' &&
        typeof (part as { text?: unknown }).text === 'string'
    )
    .map(part => part.text)
    .join('\n')
    .trim();
  if (!text) return `[${parts.length} non-text part(s)]`;
  return clipSingleLine(text, 120);
};

const formatJobsLines = (threadId?: string): string[] => {
  const jobs = listShellJobs(threadId ? { threadId } : undefined);
  if (jobs.length === 0) return ['No durable background jobs found.'];
  return [
    `Durable background jobs (${jobs.length}):`,
    ...jobs.slice(0, 20).map(job => {
      const cmd = job.command.replace(/\s+/g, ' ').trim();
      const preview = cmd.length > 70 ? `${cmd.slice(0, 67)}...` : cmd;
      const exitPart = typeof job.exitCode === 'number' ? ` exit=${job.exitCode}` : '';
      return `  ${job.jobId}  [${job.status}${exitPart}]  pid=${job.pid}  ${preview}`;
    }),
    'Usage: /jobs [all] | /jobs log <jobId> | /jobs kill <jobId>',
  ];
};

const readPersonaSummary = (dataDir: string): { path: string; chars: number; preview: string } => {
  const personaPath = path.join(dataDir, 'PERSONA.md');
  try {
    const raw = fs.readFileSync(personaPath, 'utf8').trim();
    return { path: personaPath, chars: raw.length, preview: raw.replace(/\s+/g, ' ').slice(0, 160) };
  } catch {
    return { path: personaPath, chars: 0, preview: '' };
  }
};

const cachedDiscoveredModelsByProvider = new Map<string, string[]>();

const mergeProviderModelIds = (
  configured: readonly string[],
  discovered: readonly string[]
): Array<{ model: string; discovered: boolean }> => {
  const configuredSet = new Set(configured.map(m => m.trim()).filter(Boolean));
  const seen = new Set<string>();
  const out: Array<{ model: string; discovered: boolean }> = [];
  for (const m of configured) {
    const trimmed = m.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push({ model: trimmed, discovered: false });
  }
  for (const m of discovered) {
    const trimmed = m.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push({ model: trimmed, discovered: !configuredSet.has(trimmed) });
  }
  return out;
};

const collectEnabledModels = (state: InteractiveCliState): EnabledModelOption[] =>
  getProviders()
    .filter(p => p.enabled)
    .flatMap(p =>
      mergeProviderModelIds(
        p.models ?? [],
        cachedDiscoveredModelsByProvider.get(p.id) ?? p.availableModels ?? []
      ).map(({ model, discovered }) => ({
        providerId: p.id,
        providerType: p.type,
        model,
        qualified: `${p.id}/${model}`,
        active: model === state.model && (!state.providerId || p.id === state.providerId),
        ...(discovered ? { discovered: true } : {}),
      }))
    );

/** Discovers live models from every enabled provider's API endpoint and merges with models.toml. */
export const discoverEnabledModels = async (
  state: InteractiveCliState,
  options?: { forceRefresh?: boolean }
): Promise<EnabledModelOption[]> => {
  const enabledProviders = getProviders().filter(p => p.enabled);
  const perProvider = await Promise.all(
    enabledProviders.map(async provider => {
      const descriptors = await state.chatService.getModels(
        provider.type,
        provider.id,
        {
          id: provider.id,
          ...(provider.baseUrl ? { baseUrl: provider.baseUrl } : {}),
          ...(provider.apiKey ? { apiKey: provider.apiKey } : {}),
        },
        options
      );
      const liveIds = descriptors.map(d => d.id).filter(Boolean);
      if (liveIds.length > 0) cachedDiscoveredModelsByProvider.set(provider.id, liveIds);
      return mergeProviderModelIds(
        provider.models ?? [],
        liveIds.length > 0 ? liveIds : (provider.availableModels ?? [])
      ).map(({ model, discovered }) => ({
        providerId: provider.id,
        providerType: provider.type,
        model,
        qualified: `${provider.id}/${model}`,
        active: model === state.model && (!state.providerId || provider.id === state.providerId),
        ...(discovered ? { discovered: true } : {}),
      }));
    })
  );
  return perProvider.flat();
};

export const switchModel = (arg: string, state: InteractiveCliState): string => {
  const providers = getProviders().filter(p => p.enabled);
  const slash = arg.indexOf('/');
  if (slash > 0) {
    const targetProvId = arg.slice(0, slash);
    const targetModel = arg.slice(slash + 1);
    const foundProv = providers.find(p => p.id === targetProvId);
    if (foundProv) {
      state.providerId = foundProv.id;
      state.providerType = foundProv.type;
      state.model = targetModel;
      state.chatService.updateThread(state.threadId, {
        provider_id: foundProv.id,
        provider_type: foundProv.type,
        model: targetModel,
      });
      return `Switched to ${foundProv.id}/${targetModel}`;
    }
  }
  for (const p of providers) {
    const known = new Set([
      ...(p.models ?? []),
      ...(p.availableModels ?? []),
      ...(cachedDiscoveredModelsByProvider.get(p.id) ?? []),
    ]);
    if (known.has(arg)) {
      state.providerId = p.id;
      state.providerType = p.type;
      state.model = arg;
      state.chatService.updateThread(state.threadId, {
        provider_id: p.id,
        provider_type: p.type,
        model: arg,
      });
      return `Switched to ${p.id}/${arg}`;
    }
  }
  state.model = arg;
  state.chatService.updateThread(state.threadId, { model: arg });
  return `Set model to ${arg} (not listed in models.toml enabled list)`;
};

export const formatBannerLines = async (state: InteractiveCliState): Promise<string[]> => {
  const view = rebuildThreadViewFromEvents(state.threadId);
  const providerLabel = state.providerId ? `${state.providerId}/${state.model}` : state.model;
  const repoInstructions = inspectAgentInstructionsForWorkspace(state.workspace);
  const persona = readPersonaSummary(state.dataDir);
  const skills = await listSkills({ workspacePath: state.workspace });

  const loadedSkillIds = skills.map(s => s.id);
  const skillsText =
    loadedSkillIds.length > 0
      ? loadedSkillIds.slice(0, 8).join(', ') +
        (loadedSkillIds.length > 8 ? ` (+${loadedSkillIds.length - 8})` : '')
      : 'none loaded';

  const toolsSummary = state.tools
    ? state.tools.length
      ? `${state.tools.length} selected (${state.tools.join(', ')})`
      : 'disabled'
    : `${getBuiltinToolNames().length} builtin`;

  return [
    `iKi CLI (${state.providerType}) — ${providerLabel}`,
    `thread: ${state.threadId} (${view.messages.length} msg${view.messages.length === 1 ? '' : 's'}${view.compaction ? ', compacted' : ''})`,
    '',
    '[Context]',
    `  ${repoInstructions ? `${repoInstructions.filename} (${repoInstructions.lineCount} lines, ${repoInstructions.charCount} chars)` : 'no repo AGENTS.md / AGENT.md'}`,
    `  PERSONA.md (${persona.chars > 0 ? `${persona.chars} chars` : 'empty placeholder'})`,
    '',
    '[Skills]',
    `  mode=${state.skillMode} · ${loadedSkillIds.length} loaded (${skillsText})`,
    '',
    '[Tools]',
    `  ${toolsSummary} · MCP: ${formatMcpBannerSummary(state.mcpManager, { workspacePath: state.workspace, dataDir: state.dataDir })}`,
    '',
    'Shortcuts: /models · /resume · /jobs (Ctrl+J) · /swarm (Ctrl+W) · /mcp · /context · /skills · /help',
  ];
};

const formatHelpLines = (): string[] => [
  'Commands:',
  '  /models                   Pick and switch active model (or /model <id>)',
  '  /resume                   Pick and resume a saved thread (or /thread <id>)',
  '  /new [title]              Start a fresh thread',
  '  /context                  Inspect loaded AGENTS.md, PERSONA.md, skills & tools',
  '  /skills [auto|manual|ids] Pick skills, switch skill mode, or list all',
  '  /tools [default|all|a,b]  View or override enabled tools (includes ptc)',
  '  /mcp [add|import|tools..] Manage MCP servers & inspect active MCP tools',
  '  /jobs [all|log|kill]      Inspect, tail, or stop durable background jobs (Ctrl+J)',
  '  /swarm <task|watch|...>   Start a swarm or watch live workers/board (Ctrl+W)',
  '  /history                  Inspect messages & compaction checkpoint',
  '  /compact                  Compact older turns into a persistent checkpoint',
  '  /copy                     Copy the last assistant reply to the clipboard',
  '  /usage                    Show cumulative token usage for this CLI session',
  '  /clear                    Clear screen / transcript',
  '  /exit / /quit             Exit interactive mode',
];

const formatHistoryLines = (threadId: string): string[] => {
  const view = rebuildThreadViewFromEvents(threadId);
  const active = selectMessagesForCompaction(view.messages, view.compaction);
  const lines = [
    `Thread history (${view.messages.length} total, ${active.messages.length} active for model)`,
  ];
  if (view.compaction) {
    lines.push(
      `[checkpoint] omitted=${view.compaction.omittedCount}, kept=${view.compaction.keptCount}` +
        (view.compaction.firstKeptMessageId ? `, anchor=${view.compaction.firstKeptMessageId}` : '')
    );
    lines.push(
      view.compaction.summary.slice(0, 300) +
        (view.compaction.summary.length > 300 ? '...' : '')
    );
  }
  const tail = view.messages.slice(-12);
  if (tail.length < view.messages.length) {
    lines.push(`... (${view.messages.length - tail.length} earlier message(s) hidden)`);
  }
  for (const msg of tail) {
    const tag = msg.role === 'user' ? 'you' : msg.role === 'assistant' ? 'iki' : msg.role;
    const anchor = view.compaction?.firstKeptMessageId === msg.id ? ' ◀ checkpoint anchor' : '';
    lines.push(`  ${tag}: ${readMessagePreview(msg.parts)}${anchor}`);
  }
  return lines;
};

const formatContextLines = async (state: InteractiveCliState): Promise<string[]> => {
  const persona = readPersonaSummary(state.dataDir);
  const repoInstructions = inspectAgentInstructionsForWorkspace(state.workspace);
  const skills = await listSkills({ workspacePath: state.workspace });
  const skillRoots = getSkillRootsForUi(state.workspace);
  const view = rebuildThreadViewFromEvents(state.threadId);
  const builtins = getBuiltinToolNames();
  const shellCfg = getAppConfig().tools.shell;

  return [
    'Loaded Context & Harness State:',
    `  PERSONA.md:     ${persona.path} ${persona.chars ? `(${persona.chars} chars)` : '(empty)'}`,
    ...(persona.preview ? [`    "${persona.preview}${persona.chars > 160 ? '...' : ''}"`] : []),
    `  Repo Context:   ${repoInstructions ? `${repoInstructions.filePath} (${repoInstructions.lineCount} lines, ${repoInstructions.charCount} chars)` : '(none loaded; checks AGENTS.md, AGENT.md, IKI.md)'}`,
    `  Skill Roots:    ${skillRoots.map(r => `[${r.source}] ${r.path}`).join(' · ')}`,
    `  Loaded Skills:  ${skills.length} total (mode=${state.skillMode}${state.skills?.length ? `, pinned=${state.skills.join(',')}` : ''})`,
    ...skills.slice(0, 12).map(
      s => `    - ${s.id} [${s.source}]${s.description ? ` — ${clipSingleLine(s.description, 96)}` : ''}`
    ),
    ...(skills.length > 12 ? [`    ... (+${skills.length - 12} more)`] : []),
    `  Tools:          ${state.tools ? (state.tools.length ? state.tools.join(', ') : '(disabled)') : `default (${builtins.join(', ')})`}`,
    `  MCP:            ${formatMcpBannerSummary(state.mcpManager, { workspacePath: state.workspace, dataDir: state.dataDir })}`,
    `  [tools.shell]:  timeout=${shellCfg.defaultTimeoutMs}ms (max ${shellCfg.maxTimeoutMs}ms), promoteOnTimeout=${shellCfg.promoteOnTimeout}, maxOutput=${shellCfg.maxOutputLines} lines/${shellCfg.maxOutputBytes}B${shellCfg.shellPath ? `, shellPath=${shellCfg.shellPath}` : ''}`,
    `  Compaction:     ${view.compaction ? `active (omitted=${view.compaction.omittedCount}, kept=${view.compaction.keptCount}, anchor=${view.compaction.firstKeptMessageId ?? 'tail'})` : 'none in current thread'}`,
  ];
};

const formatModelsLines = async (
  state: InteractiveCliState,
  options?: { forceRefresh?: boolean }
): Promise<string[]> => {
  const discovered = await discoverEnabledModels(state, options);
  const list = discovered.length > 0 ? discovered : collectEnabledModels(state);
  return [
    `Enabled models (${list.length}):`,
    ...list.map(
      opt =>
        `  ${opt.active ? '*' : ' '} ${opt.qualified} [${opt.providerType}${opt.discovered ? ' · live' : ''}]`
    ),
  ];
};

export const ensureThreadExists = (
  state: InteractiveCliState,
  id: string,
  title: string
): void => {
  if (!state.chatService.getThread(id)) {
    state.chatService.createThread({
      id,
      title,
      provider_type: state.providerType,
      ...(state.providerId ? { provider_id: state.providerId } : {}),
      model: state.model,
    });
  }
};

/** Removes an unused thread (zero session events, zero runs, no active swarm) so empty sessions do not pollute /resume. */
export const pruneEmptyThreadIfUnused = (
  state: InteractiveCliState,
  threadId: string
): boolean => {
  const id = threadId.trim();
  if (!id) return false;
  if (!state.chatService.getThread(id)) return false;
  if (getSessionEventRevision(id) > 0) return false;
  if (listAgentRunsByThread(id).length > 0) return false;
  if (state.swarmManager?.getSwarmForThread(id)) return false;
  state.chatService.deleteThread(id);
  return true;
};

export const buildSlashCommands = (state: InteractiveCliState): SlashCommand[] => [
  { name: 'models', description: 'Interactive model picker & switcher' },
  {
    name: 'model',
    description: 'Pick or switch active model',
    argumentHint: '<providerId/modelId>',
    getArgumentCompletions: prefix => {
      const lower = prefix.toLowerCase();
      const items = collectEnabledModels(state)
        .map(m => ({ value: m.qualified, label: m.qualified, description: m.providerType }))
        .filter(item => !lower || item.value.toLowerCase().includes(lower));
      return items.length ? items : null;
    },
  },
  { name: 'resume', description: 'Interactive thread picker & resume' },
  { name: 'threads', description: 'Pick or list recent saved threads' },
  {
    name: 'thread',
    description: 'Switch to an existing thread',
    argumentHint: '<threadId>',
    getArgumentCompletions: prefix => {
      const lower = prefix.toLowerCase();
      const items = state.chatService
        .listThreads()
        .slice(0, 20)
        .map(t => ({ value: t.id, label: t.id, description: resolveThreadDisplayTitle(t) }))
        .filter(
          item =>
            !lower ||
            item.value.toLowerCase().includes(lower) ||
            (item.description ?? '').toLowerCase().includes(lower)
        );
      return items.length ? items : null;
    },
  },
  { name: 'new', description: 'Start a fresh thread' },
  { name: 'context', description: 'Inspect loaded AGENTS.md, PERSONA.md, skills & tools' },
  { name: 'system', description: 'Alias for /context' },
  {
    name: 'skills',
    description: 'Pick skills, switch skill mode, or inspect loaded skills',
    argumentHint: 'auto | manual | clear | <skillIds>',
    getArgumentCompletions: async prefix => {
      const lower = prefix.toLowerCase();
      const discovered = await listSkills({ workspacePath: state.workspace });
      const items = [
        { value: 'auto', label: 'auto', description: 'Automatic skill selection' },
        { value: 'manual', label: 'manual', description: 'Manual skill selection' },
        { value: 'clear', label: 'clear', description: 'Clear pinned skills' },
        ...discovered.map(s => ({
          value: s.id,
          label: s.id,
          description: s.description ?? s.name,
        })),
      ].filter(item => !lower || item.value.toLowerCase().includes(lower));
      return items.length ? items : null;
    },
  },
  {
    name: 'tools',
    description: 'View or override enabled tools',
    argumentHint: 'default | all | none | <names>',
    getArgumentCompletions: prefix => {
      const parts = prefix.split(',');
      const current = (parts.pop() ?? '').trim().toLowerCase();
      const prefixBase = parts.length ? `${parts.map(s => s.trim()).filter(Boolean).join(',')},` : '';
      const candidates = ['default', 'all', 'none', ...getBuiltinToolNames()];
      const items = candidates
        .filter(name => !current || name.toLowerCase().includes(current))
        .map(name => ({ value: `${prefixBase}${name}`, label: name }));
      return items.length ? items : null;
    },
  },
  {
    name: 'jobs',
    description: 'Inspect, tail, or kill durable background jobs',
    argumentHint: 'all | log <jobId> | kill <jobId>',
    getArgumentCompletions: prefix => {
      const lower = prefix.toLowerCase();
      const jobs = listShellJobs().slice(0, 12);
      const candidates = [
        { value: 'all', label: 'all', description: 'List jobs across all threads' },
        ...jobs.flatMap(job => [
          { value: `log ${job.jobId}`, label: `log ${job.jobId}`, description: `[${job.status}] ${job.command.slice(0, 50)}` },
          ...(job.status === 'running'
            ? [{ value: `kill ${job.jobId}`, label: `kill ${job.jobId}`, description: `Kill pid ${job.pid}` }]
            : []),
        ]),
      ].filter(item => !lower || item.value.toLowerCase().includes(lower));
      return candidates.length ? candidates : null;
    },
  },
  {
    name: 'mcp',
    description: 'Manage MCP servers, import mcp.json, or list MCP tools',
    argumentHint: 'status | tools | add <name> <cmd> | add-http <name> <url> | import [path] | connect <name>',
    getArgumentCompletions: prefix => getMcpSlashCompletions(state.mcpManager, prefix),
  },
  {
    name: 'swarm',
    description: 'Start a multi-agent swarm or inspect/steer board & workers',
    argumentHint: '<task> | status | board | inspect <name> | post <msg> | steer <name> <msg> | kill <name|all>',
    getArgumentCompletions: prefix => {
      const lower = prefix.toLowerCase();
      const swarm = state.swarmManager?.getSwarmForThread(state.threadId);
      const memberNames = swarm
        ? Object.keys(swarm.members).filter(n => n !== 'coordinator')
        : [];
      const candidates = [
        { value: 'watch', label: 'watch', description: 'Live watch picker for workers & board (Ctrl+W)' },
        { value: 'status', label: 'status', description: 'Show swarm roster and member states' },
        { value: 'board', label: 'board', description: 'Show recent shared board posts' },
        { value: 'post ', label: 'post <msg>', description: 'Post to board as user' },
        { value: 'kill all', label: 'kill all', description: 'Kill all workers and clean worktrees' },
        ...memberNames.flatMap(name => [
          { value: `inspect ${name}`, label: `inspect ${name}`, description: `Inspect @${name} thread` },
          { value: `steer ${name} `, label: `steer ${name} <msg>`, description: `Steer @${name}` },
          { value: `kill ${name}`, label: `kill ${name}`, description: `Kill @${name}` },
        ]),
      ].filter(item => !lower || item.value.toLowerCase().includes(lower));
      return candidates.length ? candidates : null;
    },
  },
  { name: 'history', description: 'Inspect messages & compaction checkpoint' },
  { name: 'compact', description: 'Compact older turns into a persistent checkpoint' },
  { name: 'copy', description: 'Copy the last assistant reply to the clipboard' },
  { name: 'usage', description: 'Show session token & cache usage' },
  { name: 'clear', description: 'Clear screen / transcript' },
  { name: 'help', description: 'Show commands and shortcuts' },
  { name: 'exit', description: 'Exit interactive mode' },
  { name: 'quit', description: 'Exit interactive mode' },
];

export type SlashCommandOutcome =
  | { kind: 'handled'; lines: string[] }
  | { kind: 'clear'; lines: string[] }
  | { kind: 'run-swarm'; prompt: string; swarmId: string; created: boolean }
  | { kind: 'watch-swarm'; target?: string }
  | { kind: 'pick-model' | 'pick-thread' | 'pick-skill' | 'pick-job' }
  | { kind: 'exit' };

export const executeSlashCommand = async (
  trimmed: string,
  state: InteractiveCliState,
  totals: UsageTotals,
  options?: { interactivePickers?: boolean }
): Promise<SlashCommandOutcome> => {
  const spaceIdx = trimmed.indexOf(' ');
  const rawCmd = (spaceIdx >= 0 ? trimmed.slice(0, spaceIdx) : trimmed).toLowerCase();
  const arg = spaceIdx >= 0 ? trimmed.slice(spaceIdx + 1).trim() : '';

  const allCommandNames = [
    '/help', '/models', '/model', '/resume', '/threads', '/thread', '/new',
    '/history', '/context', '/system', '/persona', '/tools', '/mcp', '/jobs', '/swarm',
    '/skills', '/compact', '/copy', '/usage', '/clear', '/exit', '/quit',
  ];
  let cmd = rawCmd;
  if (!allCommandNames.includes(cmd)) {
    const matches = allCommandNames.filter(name => name.startsWith(rawCmd));
    if (matches.length === 1) {
      cmd = matches[0];
    } else if (matches.length > 1) {
      return {
        kind: 'handled',
        lines: [`Ambiguous command "${rawCmd}". Matches: ${matches.join(', ')}`],
      };
    }
  }

  if (cmd === '/exit' || cmd === '/quit') return { kind: 'exit' };
  if (cmd === '/help') return { kind: 'handled', lines: formatHelpLines() };
  if (cmd === '/clear') return { kind: 'clear', lines: await formatBannerLines(state) };
  if (cmd === '/models' || cmd === '/model') {
    if (arg === 'refresh') {
      return { kind: 'handled', lines: await formatModelsLines(state, { forceRefresh: true }) };
    }
    if (arg) return { kind: 'handled', lines: [switchModel(arg, state)] };
    if (options?.interactivePickers) return { kind: 'pick-model' };
    return { kind: 'handled', lines: await formatModelsLines(state) };
  }
  if (cmd === '/resume' || cmd === '/threads') {
    if (options?.interactivePickers) return { kind: 'pick-thread' };
    const threads = state.chatService.listThreads().slice(0, 15);
    return {
      kind: 'handled',
      lines: [
        'Recent threads:',
        ...threads.map(
          t =>
            `  ${t.id === state.threadId ? '*' : ' '} ${t.id}  ${resolveThreadDisplayTitle(t)} (${t.model ?? 'default'})`
        ),
      ],
    };
  }
  if (cmd === '/thread') {
    if (!arg) {
      if (options?.interactivePickers) return { kind: 'pick-thread' };
      return { kind: 'handled', lines: ['Usage: /thread <id>'] };
    }
    if (arg !== state.threadId) {
      pruneEmptyThreadIfUnused(state, state.threadId);
    }
    state.threadId = arg;
    ensureThreadExists(state, state.threadId, 'Interactive CLI');
    return { kind: 'handled', lines: formatHistoryLines(state.threadId) };
  }
  if (cmd === '/new') {
    pruneEmptyThreadIfUnused(state, state.threadId);
    state.threadId = `cli_${randomUUID().slice(0, 8)}`;
    ensureThreadExists(state, state.threadId, arg || 'Interactive CLI');
    return { kind: 'handled', lines: [`Started new thread: ${state.threadId}`] };
  }
  if (cmd === '/jobs') {
    if (!arg && options?.interactivePickers) return { kind: 'pick-job' };
    if (!arg) return { kind: 'handled', lines: formatJobsLines(state.threadId) };
    if (arg === 'all') return { kind: 'handled', lines: formatJobsLines() };
    const [sub, targetId] = arg.split(/\s+/);
    if (sub === 'kill' && targetId) {
      try { return { kind: 'handled', lines: [(await killShellJob(targetId)).message] }; }
      catch (error) { return { kind: 'handled', lines: [error instanceof Error ? error.message : String(error)] }; }
    }
    if (sub === 'log' && targetId) {
      try {
        const job = getShellJob(targetId);
        if (!job) return { kind: 'handled', lines: [`Job "${targetId}" not found.`] };
        const slice = readBoundedLogSlice(job.logPath, { maxLines: 40 });
        return { kind: 'handled', lines: [`Job ${job.jobId} [${job.status}${typeof job.exitCode === 'number' ? ` exit=${job.exitCode}` : ''}] pid=${job.pid}`, `log: ${job.logPath}`, ...(slice.output ? slice.output.split(/\r?\n/) : ['(no output yet)'])] };
      } catch (error) { return { kind: 'handled', lines: [error instanceof Error ? error.message : String(error)] }; }
    }
    return { kind: 'handled', lines: ['Usage: /jobs [all] | /jobs log <jobId> | /jobs kill <jobId>'] };
  }
  if (cmd === '/mcp') {
    return executeMcpSlashCommand(arg, state);
  }
  if (cmd === '/swarm') {
    return executeSwarmSlashCommand(arg, state, createWorkspaceSelection, options);
  }
  if (cmd === '/history') return { kind: 'handled', lines: formatHistoryLines(state.threadId) };
  if (cmd === '/compact') {
    try {
      const res = await state.chatService.compactThread(state.threadId);
      if (res.compacted === false) {
        return { kind: 'handled', lines: [`Compaction skipped: ${'reason' in res ? res.reason : 'unchanged'}`] };
      }
      return {
        kind: 'handled',
        lines: [
          `Compacted thread ${state.threadId}: omitted=${res.omittedCount}, kept=${res.keptCount}` +
            (res.firstKeptMessageId ? `, anchor=${res.firstKeptMessageId}` : ''),
          res.summary.slice(0, 300) + (res.summary.length > 300 ? '...' : ''),
        ],
      };
    } catch (error) {
      return {
        kind: 'handled',
        lines: [`Compaction failed: ${error instanceof Error ? error.message : String(error)}`],
      };
    }
  }
  if (cmd === '/context' || cmd === '/system' || cmd === '/persona') {
    return { kind: 'handled', lines: await formatContextLines(state) };
  }
  if (cmd === '/tools') {
    if (!arg) {
      const desc = state.tools ? (state.tools.length ? state.tools.join(', ') : '(disabled)') : `default (${getBuiltinToolNames().join(', ')})`;
      return { kind: 'handled', lines: [`Active tools: ${desc}`] };
    }
    if (arg === 'default') { state.tools = undefined; return { kind: 'handled', lines: ['Reset tools to harness default'] }; }
    if (arg === 'all') { state.tools = [...getBuiltinToolNames()]; return { kind: 'handled', lines: [`Enabled all ${state.tools.length} builtin tools`] }; }
    if (arg === 'none') { state.tools = []; return { kind: 'handled', lines: ['Disabled tools for next turns'] }; }
    state.tools = arg.split(',').map(s => s.trim()).filter(Boolean);
    return { kind: 'handled', lines: [`Active tools: ${state.tools.join(', ')}`] };
  }
  if (cmd === '/skills') {
    if (!arg && options?.interactivePickers) return { kind: 'pick-skill' };
    const available = await listSkills({ workspacePath: state.workspace });
    if (!arg) {
      return {
        kind: 'handled',
        lines: [
          `Skills (mode: ${state.skillMode}):`,
          ...(available.length
            ? available.map(
                s => `  ${state.skills?.includes(s.id) ? '*' : ' '} ${s.id} — ${clipSingleLine(s.description ?? s.name, 96)}`
              )
            : ['  (no skills discovered)']),
        ],
      };
    }
    if (arg === 'auto' || arg === 'manual') {
      state.skillMode = arg;
      return { kind: 'handled', lines: [`Set skillMode = ${arg}`] };
    }
    if (arg === 'clear') {
      state.skills = undefined;
      return { kind: 'handled', lines: ['Cleared explicit skill selection'] };
    }
    const requested = arg.split(',').map(s => s.trim()).filter(Boolean);
    const resolved: string[] = [];
    const errors: string[] = [];
    for (const token of requested) {
      const lower = token.toLowerCase();
      const exact = available.find(s => s.id.toLowerCase() === lower);
      if (exact) { resolved.push(exact.id); continue; }
      const shortMatches = available.filter(
        s => s.name.toLowerCase() === lower || s.id.toLowerCase().endsWith(`:${lower}`)
      );
      if (shortMatches.length === 1) resolved.push(shortMatches[0]!.id);
      else if (shortMatches.length > 1) errors.push(`Ambiguous skill "${token}" (${shortMatches.map(s => s.id).join(', ')})`);
      else errors.push(`Unknown skill "${token}"`);
    }
    if (errors.length > 0) {
      return { kind: 'handled', lines: [...errors, 'Run /skills to list available skill IDs.'] };
    }
    state.skills = [...new Set(resolved)];
    state.skillMode = 'manual';
    return { kind: 'handled', lines: [`Pinned skills: ${state.skills.join(', ')}`] };
  }
  if (cmd === '/copy') {
    return { kind: 'handled', lines: [await copyLastAssistantReply(state.threadId)] };
  }
  if (cmd === '/usage') {
    const threadCounts = countThreadTurnsAndSteps(state.threadId);
    return {
      kind: 'handled',
      lines: [
        `Thread ${state.threadId}: ${threadCounts.turns} turn(s), ${threadCounts.steps} model step(s)`,
        `Session usage: ${totals.turns} turn(s), in=${totals.uncachedInputTokens}, cache=${totals.cacheReadTokens}, out=${totals.outputTokens}`,
      ],
    };
  }
  return {
    kind: 'handled',
    lines: [`Unknown command: ${cmd}. Type /help for available commands.`],
  };
};
