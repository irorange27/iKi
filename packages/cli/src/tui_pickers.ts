import type { Component, Container, TUI } from '@earendil-works/pi-tui';
import { listSkills } from '@iki/harness/tools/skills';
import {
  discoverEnabledModels,
  ensureThreadExists,
  pruneEmptyThreadIfUnused,
  resolveThreadDisplayTitle,
  switchModel,
  type InteractiveCliState,
} from './commands';
import type { JobLiveTracker, SwarmLiveTracker } from './live_monitor';
import {
  buildJobWatchPickerItems,
  buildSwarmWatchPickerItems,
  type LiveWatchController,
} from './live_views';
import { openInlineSearchablePicker } from './selectors';
import { cliTheme, selectListTheme } from './theme';

export const createTuiPickers = (deps: {
  tui: TUI;
  state: InteractiveCliState;
  editorContainer: Container;
  editor: Component;
  swarmTracker: SwarmLiveTracker;
  jobTracker: JobLiveTracker;
  getWatchController: () => LiveWatchController | null;
  setSelectorOpen: (open: boolean) => void;
  appendInfoBlock: (lines: string[], colorFn?: (s: string) => string) => void;
  flash: (message: string, durationMs?: number) => void;
  onThreadSwitched: () => Promise<void>;
}) => {
  const createPickerTheme = () => ({
    title: (text: string) => cliTheme.bold(cliTheme.borderAccent(text)),
    dim: cliTheme.dim,
    border: cliTheme.borderAccent,
    selectList: selectListTheme,
  });

  const openInlinePicker = async <T>(params: {
    title: string;
    subtitle?: string;
    items: Array<{ value: string; label: string; description?: string; data: T }>;
    initialValue?: string;
  }) => {
    deps.setSelectorOpen(true);
    try {
      return await openInlineSearchablePicker({
        tui: deps.tui,
        container: deps.editorContainer,
        restoreComponent: deps.editor,
        ...params,
        theme: createPickerTheme(),
      });
    } finally {
      deps.setSelectorOpen(false);
    }
  };

  const openModelPicker = async () => {
    const models = await discoverEnabledModels(deps.state);
    if (models.length === 0) {
      deps.appendInfoBlock(['No enabled models found from models.toml or provider endpoints.'], cliTheme.warning);
      return;
    }
    const picked = await openInlinePicker({
      title: 'Switch Model',
      subtitle: 'Models from models.toml & live provider endpoints',
      items: models.map(m => ({
        value: m.qualified,
        label: `${m.active ? '* ' : '  '}${m.model}`,
        description: `${m.providerId} · ${m.providerType}${m.discovered ? ' · live' : ''}`,
        data: m,
      })),
      initialValue: models.find(m => m.active)?.qualified,
    });
    if (picked) {
      deps.appendInfoBlock([switchModel(picked.value, deps.state)], cliTheme.success);
    }
  };

  const openThreadPicker = async () => {
    const threads = deps.state.chatService.listThreads().slice(0, 30);
    if (threads.length === 0) {
      deps.appendInfoBlock(['No saved threads found.'], cliTheme.dim);
      return;
    }
    const picked = await openInlinePicker({
      title: 'Resume Thread',
      subtitle: 'Choose a thread to inspect and continue',
      items: threads.map(t => ({
        value: t.id,
        label: `${t.id === deps.state.threadId ? '* ' : '  '}${resolveThreadDisplayTitle(t)}`,
        description: `${t.id}${t.model ? ` · ${t.model}` : ''}`,
        data: t,
      })),
      initialValue: deps.state.threadId,
    });
    if (picked && picked.value !== deps.state.threadId) {
      deps.getWatchController()?.returnToMain();
      pruneEmptyThreadIfUnused(deps.state, deps.state.threadId);
      deps.state.threadId = picked.value;
      ensureThreadExists(deps.state, deps.state.threadId, 'Interactive CLI');
      await deps.onThreadSwitched();
    }
  };

  const openSkillPicker = async () => {
    type SkillPickerAction =
      | { kind: 'mode'; mode: 'auto' | 'manual' }
      | { kind: 'clear' }
      | { kind: 'skill'; id: string };
    const available = await listSkills({ workspacePath: deps.state.workspace });
    const picked = await openInlinePicker<SkillPickerAction>({
      title: `Skills (mode: ${deps.state.skillMode})`,
      subtitle: 'Toggle a pinned skill or switch skillMode',
      items: [
        {
          value: '__mode:auto',
          label: `${deps.state.skillMode === 'auto' ? '* ' : '  '}mode: auto`,
          description: 'Automatically select relevant skills per turn',
          data: { kind: 'mode', mode: 'auto' },
        },
        {
          value: '__mode:manual',
          label: `${deps.state.skillMode === 'manual' ? '* ' : '  '}mode: manual`,
          description: 'Use only pinned skills',
          data: { kind: 'mode', mode: 'manual' },
        },
        {
          value: '__clear',
          label: '  clear pinned skills',
          description: 'Remove explicit skill pins',
          data: { kind: 'clear' },
        },
        ...available.map(s => ({
          value: s.id,
          label: `${deps.state.skills?.includes(s.id) ? '* ' : '  '}${s.id}`,
          description: `[${s.source}] ${(s.description ?? s.name).replace(/\s+/g, ' ').slice(0, 80)}`,
          data: { kind: 'skill' as const, id: s.id },
        })),
      ],
    });
    if (!picked) return;
    if (picked.data.kind === 'mode') {
      deps.state.skillMode = picked.data.mode;
      deps.appendInfoBlock([`Set skillMode = ${deps.state.skillMode}`], cliTheme.success);
    } else if (picked.data.kind === 'clear') {
      deps.state.skills = undefined;
      deps.appendInfoBlock(['Cleared explicit skill selection'], cliTheme.success);
    } else {
      const current = new Set(deps.state.skills ?? []);
      if (current.has(picked.data.id)) current.delete(picked.data.id);
      else current.add(picked.data.id);
      deps.state.skills = [...current];
      deps.state.skillMode = 'manual';
      deps.appendInfoBlock(
        [`Pinned skills: ${deps.state.skills.length ? deps.state.skills.join(', ') : '(none)'}`],
        cliTheme.success
      );
    }
  };

  const openSwarmPicker = async (directTarget?: string) => {
    const watchController = deps.getWatchController();
    const swarm = deps.state.swarmManager?.getSwarmForThread(deps.state.threadId);
    if (!swarm || !watchController) {
      deps.flash('No active swarm on this thread. Start one with /swarm <task>.', 2200);
      return;
    }
    if (directTarget) {
      if (directTarget === 'board') { watchController.openSwarmBoard(swarm.id); return; }
      if (directTarget === 'main' || directTarget === 'coordinator') { watchController.returnToMain(); return; }
      if (watchController.openSwarmMember(swarm.id, directTarget)) return;
      deps.flash(`Unknown swarm member "@${directTarget}"`, 2200);
      return;
    }
    const built = buildSwarmWatchPickerItems(deps.swarmTracker, watchController.getMode());
    if (!built) return;
    const picked = await openInlinePicker({
      title: `Swarm Live View — ${swarm.title}`,
      subtitle: 'Watch a worker live stream (type to steer) or open shared board',
      items: built.items,
      ...(built.initialValue ? { initialValue: built.initialValue } : {}),
    });
    if (!picked) return;
    if (picked.data.kind === 'main') watchController.returnToMain();
    else if (picked.data.kind === 'board') watchController.openSwarmBoard(picked.data.swarmId);
    else watchController.openSwarmMember(picked.data.swarmId, picked.data.memberName);
  };

  const openJobPicker = async () => {
    const watchController = deps.getWatchController();
    if (!watchController) return;
    const built = buildJobWatchPickerItems(deps.jobTracker, watchController.getMode());
    if (built.items.length === 0) {
      deps.flash('No background jobs found.', 2000);
      return;
    }
    const picked = await openInlinePicker({
      title: 'Background Jobs (Live Tail)',
      subtitle: 'Select a job to stream its log output (Ctrl+K kills running job)',
      items: built.items,
      ...(built.initialValue ? { initialValue: built.initialValue } : {}),
    });
    if (!picked) return;
    if (picked.data.kind === 'main') watchController.returnToMain();
    else if (!watchController.openJobLog(picked.data.jobId)) {
      deps.flash(`Job "${picked.data.jobId}" not found.`, 2000);
    }
  };

  return {
    openModelPicker,
    openThreadPicker,
    openSkillPicker,
    openSwarmPicker,
    openJobPicker,
  };
};
