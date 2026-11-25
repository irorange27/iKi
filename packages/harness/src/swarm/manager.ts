import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { getUserDataPath } from '@iki/core/platform';
import { forkSessionEvents } from '@iki/session/session_events';
import { createThreadMailbox, type ThreadMailboxStateChange } from '../thread_session';
import type { ThreadWorkspaceSelection } from '../workspaces/thread_workspace';
import {
  cleanupIsolatedWorkspace,
  provisionIsolatedWorkspace,
  type WorkspaceIsolationMode,
} from '../workspaces/git_worktree';
import {
  appendBoardEntry,
  findSwarmRecordByThreadId,
  getBoardHeadSeq,
  listSwarmRecords,
  loadSwarmRecord,
  parseMentions,
  readBoardEntries,
  saveSwarmRecord,
  validateWorkerName,
} from './board_store';
import {
  buildMemberTurnOptions,
  buildSwarmStatusView,
  discoverSwarmModels,
  memberWorkspaceSelection,
  resolveRequestedModel,
  resolveSwarmSettings,
} from './helpers';
import { buildCoordinatorSystemPrompt } from './prompts';
import type {
  SwarmAddParams,
  SwarmBoardEntry,
  SwarmBoardParams,
  SwarmKillParams,
  SwarmManagerDeps,
  SwarmMemberRecord,
  SwarmMemberStreamEvent,
  SwarmModelOption,
  SwarmModelParams,
  SwarmModelsParams,
  SwarmPostParams,
  SwarmRecord,
  SwarmStatusParams,
  SwarmStatusView,
  SwarmTitleParams,
  SwarmWorkspaceMode,
} from './types';

export const createSwarmManager = (deps: SwarmManagerDeps) => {
  const settings = () => resolveSwarmSettings(deps.getSettings);
  const mailbox =
    deps.mailbox ??
    createThreadMailbox({
      chat: deps.chatService,
      getMaxConcurrentActive: () => settings().maxConcurrentActive,
    });

  const boardListeners = new Set<(entry: SwarmBoardEntry) => void>();
  const stateListeners = new Set<
    (event: { swarmId: string; memberName: string; change: ThreadMailboxStateChange }) => void
  >();
  const streamListeners = new Set<(event: SwarmMemberStreamEvent) => void>();

  // Mirror mailbox state transitions back to roster.json and listeners.
  mailbox.onStateChange(change => {
    const swarm = findSwarmRecordByThreadId(change.threadId);
    if (!swarm) return;
    const member = Object.values(swarm.members).find(m => m.threadId === change.threadId);
    if (!member) return;
    if (member.status !== 'killed') {
      member.status = change.current;
      member.updatedAt = new Date().toISOString();
      saveSwarmRecord(swarm);
    }
    for (const listener of stateListeners) {
      listener({ swarmId: swarm.id, memberName: member.name, change });
    }
  });

  mailbox.onStreamEvent(evt => {
    if (streamListeners.size === 0) return;
    const swarm = findSwarmRecordByThreadId(evt.threadId);
    if (!swarm) return;
    const member = Object.values(swarm.members).find(m => m.threadId === evt.threadId);
    if (!member) return;
    for (const listener of streamListeners) {
      listener({
        swarmId: swarm.id,
        memberName: member.name,
        threadId: evt.threadId,
        channel: evt.channel,
        payload: evt.payload,
      });
    }
  });

  const emitBoardEntry = (entry: SwarmBoardEntry) => {
    for (const listener of boardListeners) {
      listener(entry);
    }
  };

  const ensureMemberRegistered = (swarm: SwarmRecord, member: SwarmMemberRecord) => {
    mailbox.registerThread(member.threadId, {
      initialState: member.status === 'killed' ? 'killed' : 'waiting',
      turnBuilder: ({ events }) =>
        buildMemberTurnOptions({
          swarmId: swarm.id,
          memberName: member.name,
          events,
          cfg: settings(),
          builtinTools: deps.getBuiltinTools?.() ?? [],
          chatService: deps.chatService,
          emitBoardEntry,
        }),
    });
  };

  const requireCaller = (
    callerThreadId: string
  ): { swarm: SwarmRecord; caller: SwarmMemberRecord } => {
    const swarm = findSwarmRecordByThreadId(callerThreadId);
    if (!swarm) {
      throw new Error(
        'No active swarm is associated with this conversation. Start one with `/swarm <task>` first.'
      );
    }
    const caller = Object.values(swarm.members).find(m => m.threadId === callerThreadId);
    if (!caller) {
      throw new Error(`Thread "${callerThreadId}" is not a member of swarm "${swarm.id}".`);
    }
    for (const member of Object.values(swarm.members)) {
      ensureMemberRegistered(swarm, member);
    }
    return { swarm, caller };
  };

  const wakeMembers = (
    swarm: SwarmRecord,
    targetNames: readonly string[],
    source: string
  ): { woken: string[]; skipped: string[] } => {
    const woken: string[] = [];
    const skipped: string[] = [];

    for (const name of targetNames) {
      const target = swarm.members[name];
      if (!target || target.status === 'killed') {
        skipped.push(name);
        continue;
      }
      ensureMemberRegistered(swarm, target);

      if (target.role === 'coordinator' && deps.onCoordinatorWake) {
        const unread = readBoardEntries(swarm.id, { afterSeq: target.lastReadSeq });
        const handled = deps.onCoordinatorWake({
          swarmId: swarm.id,
          coordinatorThreadId: target.threadId,
          entries: unread,
        });
        if (handled === true) {
          woken.push(name);
          continue;
        }
      }

      mailbox.enqueue(target.threadId, {
        source,
        content: `Board updated for @${name}`,
        priority: 'normal',
      });
      woken.push(name);
    }

    return { woken, skipped };
  };

  const startSwarm = (params: {
    coordinatorThreadId: string;
    title?: string;
    providerType: string;
    providerId?: string;
    model: string;
    workspaceSelection: ThreadWorkspaceSelection | null;
  }): { swarm: SwarmRecord; created: boolean; coordinatorSystemPrompt: string } => {
    const existing = findSwarmRecordByThreadId(params.coordinatorThreadId);
    if (existing) {
      for (const member of Object.values(existing.members)) {
        ensureMemberRegistered(existing, member);
      }
      return {
        swarm: existing,
        created: false,
        coordinatorSystemPrompt: buildCoordinatorSystemPrompt(existing.id),
      };
    }

    const cfg = settings();
    const coordModel = resolveRequestedModel(cfg.defaultCoordinatorModel || undefined, {
      providerType: params.providerType,
      ...(params.providerId ? { providerId: params.providerId } : {}),
      model: params.model,
    });
    const now = new Date().toISOString();
    const swarmId = `swarm_${randomUUID().slice(0, 8)}`;
    const workspacePath = params.workspaceSelection?.workspace?.path?.trim() || null;
    const coordinator: SwarmMemberRecord = {
      name: 'coordinator',
      threadId: params.coordinatorThreadId,
      role: 'coordinator',
      parent: null,
      workspaceMode: 'inherit',
      workspacePath,
      workspaceId: params.workspaceSelection?.workspaceId ?? null,
      repoRoot: workspacePath,
      branch: null,
      providerType: coordModel.providerType,
      ...(coordModel.providerId ? { providerId: coordModel.providerId } : {}),
      model: coordModel.model,
      status: 'waiting',
      lastReadSeq: 0,
      turnsUsed: 0,
      createdAt: now,
      updatedAt: now,
    };

    const swarm: SwarmRecord = {
      id: swarmId,
      title: params.title?.trim() || 'Swarm Session',
      coordinatorThreadId: params.coordinatorThreadId,
      createdAt: now,
      updatedAt: now,
      totalTurns: 0,
      pingPongHops: 0,
      members: { coordinator },
    };

    saveSwarmRecord(swarm);
    ensureMemberRegistered(swarm, coordinator);

    const initEntry = appendBoardEntry({
      swarmId,
      sender: 'system',
      mentions: [],
      kind: 'system',
      content: `Swarm "${swarm.title}" initialized with @coordinator (${params.providerId ? `${params.providerId}/${params.model}` : params.model}).`,
    });
    coordinator.lastReadSeq = initEntry.seq;
    saveSwarmRecord(swarm);
    emitBoardEntry(initEntry);

    return {
      swarm,
      created: true,
      coordinatorSystemPrompt: buildCoordinatorSystemPrompt(swarmId),
    };
  };

  const title = (params: SwarmTitleParams): { swarmId: string; title: string } => {
    const { swarm, caller } = requireCaller(params.callerThreadId);
    if (caller.role !== 'coordinator') {
      throw new Error('Only @coordinator may set the swarm title.');
    }
    const nextTitle = params.title.trim();
    if (!nextTitle) throw new Error('Swarm title must not be empty.');
    swarm.title = nextTitle;
    saveSwarmRecord(swarm);
    const entry = appendBoardEntry({
      swarmId: swarm.id,
      sender: 'system',
      mentions: [],
      kind: 'system',
      content: `Swarm title set to "${nextTitle}".`,
    });
    emitBoardEntry(entry);
    return { swarmId: swarm.id, title: nextTitle };
  };

  const models = async (params: SwarmModelsParams): Promise<{ models: SwarmModelOption[] }> => {
    if (params.callerThreadId) {
      findSwarmRecordByThreadId(params.callerThreadId);
    }
    return discoverSwarmModels(deps.chatService);
  };

  const board = (params: SwarmBoardParams) => {
    const { swarm, caller } = requireCaller(params.callerThreadId);
    const limit = typeof params.limit === 'number' && params.limit > 0 ? Math.min(params.limit, 100) : 20;
    const entries = readBoardEntries(swarm.id, { limit });
    const latestSeq = entries.at(-1)?.seq ?? getBoardHeadSeq(swarm.id);
    if (latestSeq > caller.lastReadSeq) {
      caller.lastReadSeq = latestSeq;
      saveSwarmRecord(swarm);
    }
    return { swarmId: swarm.id, latestSeq, entries };
  };

  const status = (params: SwarmStatusParams): SwarmStatusView => {
    const { swarm } = requireCaller(params.callerThreadId);
    return buildSwarmStatusView({
      swarm,
      cfg: settings(),
      latestSeq: getBoardHeadSeq(swarm.id),
      mailbox,
    });
  };

  const add = async (params: SwarmAddParams) => {
    const { swarm, caller } = requireCaller(params.callerThreadId);
    const cfg = settings();
    const workspaceMode: WorkspaceIsolationMode = params.workspace ?? 'inherit';
    const baseName = validateWorkerName(params.name);

    const targets: Array<{ name: string; brief: string }> = [];
    if (Array.isArray(params.tasks) && params.tasks.length > 0) {
      params.tasks.forEach((slice, idx) => {
        const workerName = validateWorkerName(`${baseName}-${idx + 1}`);
        targets.push({
          name: workerName,
          brief: `${params.brief.trim()}\n\nAssigned slice (${idx + 1}/${params.tasks!.length}):\n${slice.trim()}`,
        });
      });
    } else if (typeof params.n === 'number' && params.n > 1) {
      const count = Math.trunc(params.n);
      for (let idx = 1; idx <= count; idx++) {
        const workerName = validateWorkerName(`${baseName}-${idx}`);
        targets.push({ name: workerName, brief: params.brief.trim() });
      }
    } else {
      targets.push({ name: baseName, brief: params.brief.trim() });
    }

    const activeWorkers = Object.values(swarm.members).filter(
      m => m.role === 'worker' && m.status !== 'killed'
    ).length;
    if (activeWorkers + targets.length > cfg.maxWorkers) {
      throw new Error(
        `Cannot spawn ${targets.length} worker(s): active workers (${activeWorkers}) would exceed maxWorkers (${cfg.maxWorkers}).`
      );
    }

    for (const target of targets) {
      if (swarm.members[target.name]) {
        throw new Error(`Swarm member "@${target.name}" already exists.`);
      }
    }

    let forkSource: SwarmMemberRecord | undefined;
    if (params.fork?.trim()) {
      const forkKey = params.fork.trim().replace(/^@/, '');
      forkSource = swarm.members[forkKey];
      if (!forkSource) {
        throw new Error(`Cannot fork from unknown member "${params.fork}".`);
      }
    }

    const resolvedModel = resolveRequestedModel(
      params.model?.trim() || cfg.defaultWorkerModel?.trim() || undefined,
      {
        providerType: caller.providerType,
        ...(caller.providerId ? { providerId: caller.providerId } : {}),
        model: caller.model,
      }
    );

    const callerWorkspace = memberWorkspaceSelection(caller);
    const worktreeBaseDir = path.join(getUserDataPath(), cfg.worktreeDirName);
    const spawned: Array<{
      name: string;
      threadId: string;
      model: string;
      workspaceMode: SwarmWorkspaceMode;
      workspacePath: string | null;
      branch: string | null;
      dirtyWarning?: string;
      boardSeq: number;
    }> = [];

    for (const target of targets) {
      const workerThreadId = `swarm_${swarm.id.replace(/^swarm_/, '')}_${target.name}_${randomUUID().slice(0, 6)}`;
      const provisioned = provisionIsolatedWorkspace({
        mode: workspaceMode,
        threadId: workerThreadId,
        ownerId: swarm.id,
        label: target.name,
        parentSelection: callerWorkspace,
        baseDir: worktreeBaseDir,
        branchPrefix: cfg.branchPrefix,
      });

      deps.chatService.createThread({
        id: workerThreadId,
        title: `[swarm:${swarm.id}] @${target.name}`,
        provider_type: resolvedModel.providerType,
        ...(resolvedModel.providerId ? { provider_id: resolvedModel.providerId } : {}),
        model: resolvedModel.model,
        ...(provisioned.workspaceId ? { workspace_id: provisioned.workspaceId } : {}),
      });

      if (forkSource) {
        forkSessionEvents(forkSource.threadId, workerThreadId);
      }

      const preBriefSeq = getBoardHeadSeq(swarm.id);
      const now = new Date().toISOString();
      const member: SwarmMemberRecord = {
        name: target.name,
        threadId: workerThreadId,
        role: 'worker',
        parent: caller.name,
        workspaceMode,
        workspacePath: provisioned.workspacePath,
        workspaceId: provisioned.workspaceId,
        repoRoot: provisioned.repoRoot,
        branch: provisioned.branch,
        providerType: resolvedModel.providerType,
        ...(resolvedModel.providerId ? { providerId: resolvedModel.providerId } : {}),
        model: resolvedModel.model,
        status: 'waiting',
        lastReadSeq: preBriefSeq,
        turnsUsed: 0,
        createdAt: now,
        updatedAt: now,
      };

      swarm.members[target.name] = member;
      saveSwarmRecord(swarm);
      ensureMemberRegistered(swarm, member);

      const briefEntry = appendBoardEntry({
        swarmId: swarm.id,
        sender: caller.name,
        mentions: [target.name],
        kind: 'brief',
        content: `@${target.name}\n\n${target.brief}`,
      });
      emitBoardEntry(briefEntry);

      wakeMembers(swarm, [target.name], 'board');

      spawned.push({
        name: target.name,
        threadId: workerThreadId,
        model: resolvedModel.providerId
          ? `${resolvedModel.providerId}/${resolvedModel.model}`
          : resolvedModel.model,
        workspaceMode,
        workspacePath: provisioned.workspacePath,
        branch: provisioned.branch,
        ...(provisioned.dirtyWarning ? { dirtyWarning: provisioned.dirtyWarning } : {}),
        boardSeq: briefEntry.seq,
      });
    }

    return {
      swarmId: swarm.id,
      spawned,
    };
  };

  const post = (params: SwarmPostParams) => {
    const { swarm, caller } = requireCaller(params.callerThreadId);
    const cfg = settings();
    const content = params.message.trim();
    if (!content) throw new Error('Board post message must not be empty.');

    const knownNames = Object.keys(swarm.members);
    const { mentions: rawMentions, broadcastAll } = parseMentions(content, knownNames);

    let targets = broadcastAll
      ? Object.values(swarm.members)
          .filter(m => m.name !== caller.name && m.status !== 'killed')
          .map(m => m.name)
      : rawMentions.filter(name => name !== caller.name);

    const truncatedMentions = targets.length > cfg.maxMentionsPerPost;
    if (truncatedMentions) {
      targets = targets.slice(0, cfg.maxMentionsPerPost);
    }

    const entry = appendBoardEntry({
      swarmId: swarm.id,
      sender: caller.name,
      mentions: targets,
      kind: 'post',
      content,
    });
    // Advance sender's cursor so it does not re-read its own post.
    caller.lastReadSeq = Math.max(caller.lastReadSeq, entry.seq);
    saveSwarmRecord(swarm);
    emitBoardEntry(entry);

    if (targets.length === 0) {
      return {
        swarmId: swarm.id,
        seq: entry.seq,
        woken: [] as string[],
        skipped: [] as string[],
      };
    }

    if (swarm.pingPongHops >= cfg.maxPingPongHops) {
      const guardEntry = appendBoardEntry({
        swarmId: swarm.id,
        sender: 'system',
        mentions: ['coordinator'],
        kind: 'system',
        content: `Automated handoff limit reached (${swarm.pingPongHops}/${cfg.maxPingPongHops} hops without human input). Pausing automatic wakeups; human intervention via /swarm post or /swarm steer resets the counter.`,
      });
      emitBoardEntry(guardEntry);
      return {
        swarmId: swarm.id,
        seq: entry.seq,
        woken: [] as string[],
        skipped: targets,
        guardrailTriggered: 'maxPingPongHops',
      };
    }

    swarm.pingPongHops += 1;
    saveSwarmRecord(swarm);

    const { woken, skipped } = wakeMembers(swarm, targets, 'board');
    return {
      swarmId: swarm.id,
      seq: entry.seq,
      woken,
      skipped,
      ...(truncatedMentions ? { truncatedMentions: true } : {}),
    };
  };

  const switchMemberModel = (params: SwarmModelParams) => {
    const { swarm, caller } = requireCaller(params.callerThreadId);
    const targetName = params.name?.trim().replace(/^@/, '') || caller.name;
    const target = swarm.members[targetName];
    if (!target) {
      throw new Error(`Unknown swarm member "${targetName}".`);
    }
    if (target.status === 'killed') {
      throw new Error(`Cannot switch model for killed member "@${targetName}".`);
    }

    const isSelf = target.name === caller.name;
    const canManage =
      caller.role === 'coordinator' || isSelf || target.parent === caller.name;
    if (!canManage) {
      throw new Error(
        `Worker "@${caller.name}" may only switch models for itself or helpers it spawned.`
      );
    }

    const liveState = mailbox.getState(target.threadId);
    if (!isSelf && liveState === 'working') {
      throw new Error(
        `Member "@${targetName}" is currently working. Wait until it is waiting before switching its model.`
      );
    }

    const resolved = resolveRequestedModel(params.model, {
      providerType: target.providerType,
      ...(target.providerId ? { providerId: target.providerId } : {}),
      model: target.model,
    });
    const previousLabel = target.providerId ? `${target.providerId}/${target.model}` : target.model;
    const nextLabel = resolved.providerId ? `${resolved.providerId}/${resolved.model}` : resolved.model;

    target.providerType = resolved.providerType;
    target.providerId = resolved.providerId;
    target.model = resolved.model;
    target.updatedAt = new Date().toISOString();
    saveSwarmRecord(swarm);

    deps.chatService.updateThread(target.threadId, {
      provider_type: resolved.providerType,
      ...(resolved.providerId ? { provider_id: resolved.providerId } : {}),
      model: resolved.model,
    });

    const note = appendBoardEntry({
      swarmId: swarm.id,
      sender: 'system',
      mentions: isSelf ? [] : [target.name],
      kind: 'system',
      content: `Switched @${target.name} model from ${previousLabel} to ${nextLabel}${params.reason?.trim() ? ` (${params.reason.trim()})` : ''}. Conversation history preserved.`,
    });
    emitBoardEntry(note);

    return {
      swarmId: swarm.id,
      member: target.name,
      previousModel: previousLabel,
      model: nextLabel,
    };
  };

  const kill = async (params: SwarmKillParams) => {
    const { swarm, caller } = requireCaller(params.callerThreadId);
    const targetName = params.name.trim().replace(/^@/, '');
    if (targetName === 'coordinator') {
      throw new Error('Cannot kill @coordinator.');
    }
    const target = swarm.members[targetName];
    if (!target) {
      throw new Error(`Unknown swarm member "${targetName}".`);
    }

    const canKill = caller.role === 'coordinator' || target.parent === caller.name;
    if (!canKill) {
      throw new Error(
        `Worker "@${caller.name}" may only kill helpers it spawned (not "@${targetName}").`
      );
    }

    if (target.status === 'killed') {
      return {
        swarmId: swarm.id,
        name: target.name,
        alreadyKilled: true,
      };
    }

    await mailbox.kill(target.threadId);
    cleanupIsolatedWorkspace({
      mode: target.workspaceMode,
      repoRoot: target.repoRoot,
      workspacePath: target.workspacePath,
      workspaceId: target.workspaceId,
      branch: target.branch,
      deleteBranch: params.deleteBranch === true,
    });

    const now = new Date().toISOString();
    target.status = 'killed';
    target.killedAt = now;
    target.updatedAt = now;
    saveSwarmRecord(swarm);

    const entry = appendBoardEntry({
      swarmId: swarm.id,
      sender: 'system',
      mentions: [],
      kind: 'system',
      content: `@${caller.name} killed @${target.name}${target.workspaceMode !== 'inherit' ? ` and removed its ${target.workspaceMode} workspace` : ''}.`,
    });
    emitBoardEntry(entry);

    return {
      swarmId: swarm.id,
      name: target.name,
      killed: true,
      cleanedWorkspace: target.workspaceMode !== 'inherit',
    };
  };

  const postAsUser = (swarmId: string, message: string) => {
    const swarm = loadSwarmRecord(swarmId);
    if (!swarm) throw new Error(`Swarm "${swarmId}" not found.`);
    const content = message.trim();
    if (!content) throw new Error('Message must not be empty.');

    // Human intervention resets automated ping-pong counter.
    swarm.pingPongHops = 0;
    saveSwarmRecord(swarm);

    const { mentions: rawMentions, broadcastAll } = parseMentions(
      content,
      Object.keys(swarm.members)
    );
    const targets = broadcastAll
      ? Object.values(swarm.members)
          .filter(m => m.status !== 'killed')
          .map(m => m.name)
      : rawMentions;

    const entry = appendBoardEntry({
      swarmId: swarm.id,
      sender: 'user',
      mentions: targets,
      kind: 'post',
      content,
    });
    emitBoardEntry(entry);

    const { woken, skipped } = wakeMembers(swarm, targets, 'board');
    return { seq: entry.seq, woken, skipped };
  };

  const steerMember = (swarmId: string, memberName: string, message: string) => {
    const swarm = loadSwarmRecord(swarmId);
    if (!swarm) throw new Error(`Swarm "${swarmId}" not found.`);
    const normalized = memberName.trim().replace(/^@/, '');
    const target = swarm.members[normalized];
    if (!target) throw new Error(`Unknown swarm member "@${normalized}".`);
    if (target.status === 'killed') {
      throw new Error(`Member "@${normalized}" is killed and cannot be steered.`);
    }

    swarm.pingPongHops = 0;
    saveSwarmRecord(swarm);
    ensureMemberRegistered(swarm, target);

    const entry = appendBoardEntry({
      swarmId: swarm.id,
      sender: 'user',
      mentions: [target.name],
      kind: 'system',
      content: `[steer -> @${target.name}] ${message.trim()}`,
    });
    emitBoardEntry(entry);

    return mailbox.enqueue(target.threadId, {
      source: 'user-steer',
      content: message.trim(),
      priority: 'steer',
    });
  };

  const killAllWorkers = async (swarmId: string): Promise<string[]> => {
    const swarm = loadSwarmRecord(swarmId);
    if (!swarm) return [];
    const killed: string[] = [];
    for (const member of Object.values(swarm.members)) {
      if (member.role === 'worker' && member.status !== 'killed') {
        await kill({
          callerThreadId: swarm.coordinatorThreadId,
          name: member.name,
        });
        killed.push(member.name);
      }
    }
    return killed;
  };

  const waitForIdle = (swarmId: string, timeoutMs = 30_000): Promise<void> => {
    const swarm = loadSwarmRecord(swarmId);
    if (!swarm) return Promise.resolve();
    const threadIds = Object.values(swarm.members).map(m => m.threadId);
    return mailbox.waitForIdle(threadIds, timeoutMs);
  };

  const onBoardEntry = (listener: (entry: SwarmBoardEntry) => void): (() => void) => {
    boardListeners.add(listener);
    return () => boardListeners.delete(listener);
  };

  const onMemberStateChange = (
    listener: (event: {
      swarmId: string;
      memberName: string;
      change: ThreadMailboxStateChange;
    }) => void
  ): (() => void) => {
    stateListeners.add(listener);
    return () => stateListeners.delete(listener);
  };

  const onMemberStreamEvent = (
    listener: (event: SwarmMemberStreamEvent) => void
  ): (() => void) => {
    streamListeners.add(listener);
    return () => streamListeners.delete(listener);
  };

  return {
    mailbox,
    startSwarm,
    title,
    models,
    status,
    board,
    add,
    post,
    model: switchMemberModel,
    kill,
    postAsUser,
    steerMember,
    killAllWorkers,
    waitForIdle,
    getSwarm: loadSwarmRecord,
    getSwarmForThread: findSwarmRecordByThreadId,
    listSwarms: listSwarmRecords,
    readBoard: readBoardEntries,
    onBoardEntry,
    onMemberStateChange,
    onMemberStreamEvent,
  };
};

export type SwarmManager = ReturnType<typeof createSwarmManager>;
