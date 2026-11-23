import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { SlashCommand } from '@earendil-works/pi-tui';
import { getProviders } from '@iki/store/providers';
import { getAppConfig } from '@iki/harness/config';
import { getBuiltinToolNames } from '@iki/harness/tools';
import {
  getShellJob,
  killShellJob,
  listShellJobs,
  readBoundedLogSlice,
} from '@iki/tools/shell';
import { listSkills } from '@iki/harness/tools/skills';
import { inspectAgentInstructionsForWorkspace } from '@iki/harness/turn_prep/context_blocks';
import {
  rebuildThreadViewFromEvents,
  selectMessagesForCompaction,
} from '@iki/harness/thread_session/session_log';
import type { ChatService } from '@iki/harness/thread_session';

export type InteractiveCliState = {
  chatService: ChatService;
  dataDir: string;
  threadId: string;
  providerType: string;
  providerId?: string;
  model: string;
  workspace?: string;
  tools?: string[];
  skills?: string[];
  skillMode: 'manual' | 'auto';
  initialPrompt?: string;
};

export type UsageTotals = {
  turns: number;
  inputTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
};

export type EnabledModelOption = {
  providerId: string;
  providerType: string;
  model: string;
  qualified: string;
  active: boolean;
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
  const singleLine = text.replace(/\s+/g, ' ');
  return singleLine.length > 120 ? `${singleLine.slice(0, 117)}...` : singleLine;
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
    return {
      path: personaPath,
      chars: raw.length,
      preview: raw.replace(/\s+/g, ' ').slice(0, 160),
    };
  } catch {
    return { path: personaPath, chars: 0, preview: '' };
  }
};

const listRepoLocalAgentSkills = (workspacePath?: string): string[] => {
  if (!workspacePath) return [];
  const skillsDir = path.join(workspacePath, '.agents', 'skills');
  try {
    if (!fs.existsSync(skillsDir)) return [];
    return fs
      .readdirSync(skillsDir, { withFileTypes: true })
      .filter(entry => entry.isDirectory() && fs.existsSync(path.join(skillsDir, entry.name, 'SKILL.md')))
      .map(entry => entry.name)
      .sort();
  } catch {
    return [];
  }
};

export const collectEnabledModels = (state: InteractiveCliState): EnabledModelOption[] =>
  getProviders()
    .filter(p => p.enabled)
    .flatMap(p =>
      (p.models ?? []).map(m => ({
        providerId: p.id,
        providerType: p.type,
        model: m,
        qualified: `${p.id}/${m}`,
        active: m === state.model && (!state.providerId || p.id === state.providerId),
      }))
    );

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
    if ((p.models ?? []).includes(arg)) {
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
  const skills = await listSkills();
  const repoSkillNames = listRepoLocalAgentSkills(state.workspace);

  const loadedSkillIds = skills.map(s => s.id);
  const skillsText =
    loadedSkillIds.length > 0
      ? loadedSkillIds.join(', ')
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
    `  mode=${state.skillMode} · ${skillsText}`,
    ...(repoSkillNames.length ? [`  repo .agents/skills (${repoSkillNames.length}): ${repoSkillNames.slice(0, 8).join(', ')}${repoSkillNames.length > 8 ? ` (+${repoSkillNames.length - 8})` : ''}`] : []),
    '',
    '[Tools]',
    `  ${toolsSummary}`,
    '',
    'Shortcuts: /models · /resume · /jobs · /context · /skills · /help',
  ];
};

const formatHelpLines = (): string[] => [
  'Commands:',
  '  /models                   Pick and switch active model (or /model <id>)',
  '  /resume                   Pick and resume a saved thread (or /thread <id>)',
  '  /new [title]              Start a fresh thread',
  '  /context                  Inspect loaded AGENTS.md, PERSONA.md, skills & tools',
  '  /skills [auto|manual|ids] Pick skills, switch skill mode, or list all',
  '  /tools [default|all|a,b]  View or override enabled tools',
  '  /jobs [all|log|kill]      Inspect, tail, or stop durable background jobs',
  '  /history                  Inspect messages & compaction checkpoint',
  '  /compact                  Compact older turns into a persistent checkpoint',
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
  const skills = await listSkills();
  const repoSkillNames = listRepoLocalAgentSkills(state.workspace);
  const view = rebuildThreadViewFromEvents(state.threadId);
  const builtins = getBuiltinToolNames();
  const shellCfg = getAppConfig().tools.shell;

  return [
    'Loaded Context & Harness State:',
    `  PERSONA.md:     ${persona.path} ${persona.chars ? `(${persona.chars} chars)` : '(empty)'}`,
    ...(persona.preview ? [`    "${persona.preview}${persona.chars > 160 ? '...' : ''}"`] : []),
    `  Repo Context:   ${repoInstructions ? `${repoInstructions.filePath} (${repoInstructions.lineCount} lines, ${repoInstructions.charCount} chars)` : '(none loaded; checks AGENTS.md, AGENT.md, IKI.md)'}`,
    `  Loaded Skills:  ${skills.length} total (mode=${state.skillMode}${state.skills?.length ? `, pinned=${state.skills.join(',')}` : ''})`,
    ...skills.slice(0, 12).map(
      s => `    - ${s.id} [${s.source}]${s.description ? ` — ${s.description}` : ''}`
    ),
    ...(skills.length > 12 ? [`    ... (+${skills.length - 12} more)`] : []),
    ...(repoSkillNames.length
      ? [
          `  Repo .agents/skills (workspace files, not auto-registered unless copied to ~/.iki/skills): ${repoSkillNames.join(', ')}`,
        ]
      : []),
    `  Tools:          ${state.tools ? (state.tools.length ? state.tools.join(', ') : '(disabled)') : `default (${builtins.join(', ')})`}`,
    `  [tools.shell]:  timeout=${shellCfg.defaultTimeoutMs}ms (max ${shellCfg.maxTimeoutMs}ms), promoteOnTimeout=${shellCfg.promoteOnTimeout}, maxOutput=${shellCfg.maxOutputLines} lines/${shellCfg.maxOutputBytes}B${shellCfg.shellPath ? `, shellPath=${shellCfg.shellPath}` : ''}`,
    `  Compaction:     ${view.compaction ? `active (omitted=${view.compaction.omittedCount}, kept=${view.compaction.keptCount}, anchor=${view.compaction.firstKeptMessageId ?? 'tail'})` : 'none in current thread'}`,
  ];
};

const formatModelsLines = (state: InteractiveCliState): string[] => {
  const options = collectEnabledModels(state);
  return [
    'Enabled models:',
    ...options.map(opt => `  ${opt.active ? '*' : ' '} ${opt.qualified} [${opt.providerType}]`),
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
        .map(t => ({ value: t.id, label: t.id, description: t.title }))
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
      const discovered = await listSkills();
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
  { name: 'history', description: 'Inspect messages & compaction checkpoint' },
  { name: 'compact', description: 'Compact older turns into a persistent checkpoint' },
  { name: 'usage', description: 'Show session token & cache usage' },
  { name: 'clear', description: 'Clear screen / transcript' },
  { name: 'help', description: 'Show commands and shortcuts' },
  { name: 'exit', description: 'Exit interactive mode' },
  { name: 'quit', description: 'Exit interactive mode' },
];

export type SlashCommandOutcome =
  | { kind: 'handled'; lines: string[] }
  | { kind: 'clear'; lines: string[] }
  | { kind: 'pick-model' | 'pick-thread' | 'pick-skill' }
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
    '/help',
    '/models',
    '/model',
    '/resume',
    '/threads',
    '/thread',
    '/new',
    '/history',
    '/context',
    '/system',
    '/persona',
    '/tools',
    '/jobs',
    '/skills',
    '/compact',
    '/usage',
    '/clear',
    '/exit',
    '/quit',
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
    if (arg) return { kind: 'handled', lines: [switchModel(arg, state)] };
    if (options?.interactivePickers) return { kind: 'pick-model' };
    return { kind: 'handled', lines: formatModelsLines(state) };
  }
  if (cmd === '/resume' || cmd === '/threads') {
    if (options?.interactivePickers) return { kind: 'pick-thread' };
    const threads = state.chatService.listThreads().slice(0, 15);
    return {
      kind: 'handled',
      lines: [
        'Recent threads:',
        ...threads.map(
          t => `  ${t.id === state.threadId ? '*' : ' '} ${t.id}  ${t.title} (${t.model ?? 'default'})`
        ),
      ],
    };
  }
  if (cmd === '/thread') {
    if (!arg) {
      if (options?.interactivePickers) return { kind: 'pick-thread' };
      return { kind: 'handled', lines: ['Usage: /thread <id>'] };
    }
    state.threadId = arg;
    ensureThreadExists(state, state.threadId, 'Interactive CLI');
    return { kind: 'handled', lines: formatHistoryLines(state.threadId) };
  }
  if (cmd === '/new') {
    state.threadId = `cli_${randomUUID().slice(0, 8)}`;
    ensureThreadExists(state, state.threadId, arg || 'Interactive CLI');
    return { kind: 'handled', lines: [`Started new thread: ${state.threadId}`] };
  }
  if (cmd === '/jobs') {
    if (!arg) return { kind: 'handled', lines: formatJobsLines(state.threadId) };
    if (arg === 'all') return { kind: 'handled', lines: formatJobsLines() };
    const [sub, targetId] = arg.split(/\s+/);
    if (sub === 'kill' && targetId) {
      try {
        const res = await killShellJob(targetId);
        return { kind: 'handled', lines: [res.message] };
      } catch (error) {
        return { kind: 'handled', lines: [error instanceof Error ? error.message : String(error)] };
      }
    }
    if (sub === 'log' && targetId) {
      try {
        const job = getShellJob(targetId);
        if (!job) return { kind: 'handled', lines: [`Job "${targetId}" not found.`] };
        const slice = readBoundedLogSlice(job.logPath, { maxLines: 40 });
        return {
          kind: 'handled',
          lines: [
            `Job ${job.jobId} [${job.status}${typeof job.exitCode === 'number' ? ` exit=${job.exitCode}` : ''}] pid=${job.pid}`,
            `log: ${job.logPath}`,
            ...(slice.output ? slice.output.split(/\r?\n/) : ['(no output yet)']),
          ],
        };
      } catch (error) {
        return { kind: 'handled', lines: [error instanceof Error ? error.message : String(error)] };
      }
    }
    return { kind: 'handled', lines: ['Usage: /jobs [all] | /jobs log <jobId> | /jobs kill <jobId>'] };
  }
  if (cmd === '/history') return { kind: 'handled', lines: formatHistoryLines(state.threadId) };
  if (cmd === '/compact') {
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
  }
  if (cmd === '/context' || cmd === '/system' || cmd === '/persona') {
    return { kind: 'handled', lines: await formatContextLines(state) };
  }
  if (cmd === '/tools') {
    if (!arg) {
      return {
        kind: 'handled',
        lines: [
          `Active tools: ${state.tools ? (state.tools.length ? state.tools.join(', ') : '(disabled)') : `default (${getBuiltinToolNames().join(', ')})`}`,
        ],
      };
    }
    if (arg === 'default') {
      state.tools = undefined;
      return { kind: 'handled', lines: ['Reset tools to harness default'] };
    }
    if (arg === 'all') {
      state.tools = [...getBuiltinToolNames()];
      return { kind: 'handled', lines: [`Enabled all ${state.tools.length} builtin tools`] };
    }
    if (arg === 'none') {
      state.tools = [];
      return { kind: 'handled', lines: ['Disabled tools for next turns'] };
    }
    state.tools = arg.split(',').map(s => s.trim()).filter(Boolean);
    return { kind: 'handled', lines: [`Active tools: ${state.tools.join(', ')}`] };
  }
  if (cmd === '/skills') {
    if (!arg && options?.interactivePickers) return { kind: 'pick-skill' };
    const available = await listSkills();
    if (!arg) {
      return {
        kind: 'handled',
        lines: [
          `Skills (mode: ${state.skillMode}):`,
          ...(available.length
            ? available.map(
                s => `  ${state.skills?.includes(s.id) ? '*' : ' '} ${s.id} — ${s.description ?? s.name}`
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
    state.skills = arg.split(',').map(s => s.trim()).filter(Boolean);
    state.skillMode = 'manual';
    return { kind: 'handled', lines: [`Pinned skills: ${state.skills.join(', ')}`] };
  }
  if (cmd === '/usage') {
    return {
      kind: 'handled',
      lines: [
        `Session usage: ${totals.turns} turn(s), in=${totals.inputTokens}, cacheRead=${totals.cacheReadTokens}, out=${totals.outputTokens}`,
      ],
    };
  }
  return {
    kind: 'handled',
    lines: [`Unknown command: ${cmd}. Type /help for available commands.`],
  };
};
