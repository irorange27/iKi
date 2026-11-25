import { randomUUID } from 'node:crypto';
import {
  SwarmToolSettingsSchema,
  type SwarmToolSettings,
} from '@iki/core/domain/settings';
import { getProviders } from '@iki/store/providers';
import { getAppConfig } from '../config';
import type { ChatService, ThreadMailboxEvent } from '../thread_session';
import {
  resolveThreadWorkspaceSelectionSnapshot,
  type ThreadWorkspaceSelection,
} from '../workspaces/thread_workspace';
import {
  appendBoardEntry,
  loadSwarmRecord,
  readBoardEntries,
  saveSwarmRecord,
} from './board_store';
import {
  buildCoordinatorSystemPrompt,
  buildWorkerSystemPrompt,
  formatBoardDeltaUserMessage,
} from './prompts';
import type { SwarmBoardEntry, SwarmMemberRecord, SwarmModelOption } from './types';

const DEFAULT_SWARM_SETTINGS: SwarmToolSettings = SwarmToolSettingsSchema.parse({});
const MUTATING_FILE_TOOLS = new Set(['write_file', 'edit', 'undo_edit', 'delete_file']);

export const resolveSwarmSettings = (
  getSettings?: () => Partial<SwarmToolSettings> | null | undefined
): SwarmToolSettings => {
  try {
    const raw = getSettings ? getSettings() : getAppConfig().tools.swarm;
    if (!raw) return DEFAULT_SWARM_SETTINGS;
    const parsed = SwarmToolSettingsSchema.safeParse({ ...DEFAULT_SWARM_SETTINGS, ...raw });
    return parsed.success ? parsed.data : DEFAULT_SWARM_SETTINGS;
  } catch {
    return DEFAULT_SWARM_SETTINGS;
  }
};

export const collectEnabledModelOptions = (): SwarmModelOption[] =>
  getProviders()
    .filter(p => p.enabled)
    .flatMap(p =>
      (p.models ?? []).map(model => ({
        providerId: p.id,
        providerType: p.type,
        model,
        qualified: `${p.id}/${model}`,
      }))
    );

export const resolveRequestedModel = (
  requested: string | undefined,
  fallback: { providerType: string; providerId?: string; model: string }
): { providerType: string; providerId?: string; model: string } => {
  const trimmed = requested?.trim();
  if (!trimmed) return { ...fallback };

  const options = collectEnabledModelOptions();
  const byQualified = options.find(opt => opt.qualified === trimmed);
  if (byQualified) {
    return {
      providerType: byQualified.providerType,
      providerId: byQualified.providerId,
      model: byQualified.model,
    };
  }
  const byModel = options.find(opt => opt.model === trimmed);
  if (byModel) {
    return {
      providerType: byModel.providerType,
      providerId: byModel.providerId,
      model: byModel.model,
    };
  }

  const slash = trimmed.indexOf('/');
  if (slash > 0) {
    const provId = trimmed.slice(0, slash);
    const modelId = trimmed.slice(slash + 1);
    const provider = getProviders().find(p => p.id === provId);
    if (provider && modelId) {
      return {
        providerType: provider.type,
        providerId: provider.id,
        model: modelId,
      };
    }
  }

  return {
    providerType: fallback.providerType,
    ...(fallback.providerId ? { providerId: fallback.providerId } : {}),
    model: trimmed,
  };
};

export const memberWorkspaceSelection = (
  member: SwarmMemberRecord
): ThreadWorkspaceSelection | null => {
  if (!member.workspacePath || !member.workspaceId) {
    return resolveThreadWorkspaceSelectionSnapshot(member.threadId);
  }
  const now = member.updatedAt || new Date().toISOString();
  return {
    threadId: member.threadId,
    workspaceId: member.workspaceId,
    workspace: {
      id: member.workspaceId,
      name: `${member.name} (${member.workspaceMode})`,
      path: member.workspacePath,
      is_temporary: member.workspaceMode !== 'inherit',
      show_in_list: false,
      created_at: member.createdAt || now,
      updated_at: now,
    },
  };
};

const resolveMemberTools = (
  member: SwarmMemberRecord,
  cfg: SwarmToolSettings,
  builtinTools: readonly string[]
): string[] => {
  if (member.role === 'coordinator') {
    return [...new Set([...builtinTools, 'swarm'])];
  }
  if (member.workspaceMode === 'inherit') {
    if (cfg.inheritReadOnlyTools.length > 0) {
      return [...new Set([...cfg.inheritReadOnlyTools, 'swarm'])];
    }
    return [...new Set([...builtinTools.filter(name => !MUTATING_FILE_TOOLS.has(name)), 'swarm'])];
  }
  return [...new Set([...builtinTools, 'swarm'])];
};

const resolveMemberApprovalPolicy = (member: SwarmMemberRecord, cfg: SwarmToolSettings): string =>
  member.workspaceMode === 'inherit' ? cfg.inheritApprovalPolicy : cfg.isolatedApprovalPolicy;

export const buildMemberTurnOptions = (params: {
  swarmId: string;
  memberName: string;
  events: ReadonlyArray<ThreadMailboxEvent>;
  cfg: SwarmToolSettings;
  builtinTools: readonly string[];
  chatService: ChatService;
  emitBoardEntry: (entry: SwarmBoardEntry) => void;
}) => {
  const { swarmId, memberName, events, cfg, builtinTools, chatService, emitBoardEntry } = params;
  const swarm = loadSwarmRecord(swarmId);
  if (!swarm) return null;
  const member = swarm.members[memberName];
  if (!member || member.status === 'killed') return null;

  if (swarm.totalTurns >= cfg.maxTotalTurns) {
    const budgetNote = appendBoardEntry({
      swarmId,
      sender: 'system',
      mentions: ['coordinator'],
      kind: 'system',
      content: `Swarm turn budget reached (${swarm.totalTurns}/${cfg.maxTotalTurns}). Skipping wake for @${memberName}.`,
    });
    emitBoardEntry(budgetNote);
    return null;
  }

  const unreadBoard = readBoardEntries(swarmId, { afterSeq: member.lastReadSeq });
  const latestSeq = unreadBoard.at(-1)?.seq ?? member.lastReadSeq;
  const directPrompts = events
    .filter(evt => evt.source !== 'board')
    .map(evt => evt.content.trim())
    .filter(Boolean);

  const sections: string[] = [];
  if (unreadBoard.length > 0) {
    sections.push(
      formatBoardDeltaUserMessage({
        memberName: member.name,
        swarmTitle: swarm.title,
        entries: unreadBoard,
      })
    );
  }
  if (directPrompts.length > 0) {
    sections.push(directPrompts.join('\n\n'));
  }
  if (sections.length === 0) return null;

  member.lastReadSeq = latestSeq;
  member.turnsUsed += 1;
  swarm.totalTurns += 1;
  saveSwarmRecord(swarm);

  const promptText = sections.join('\n\n');
  const history = chatService.listMessages(member.threadId);
  const userMessage = {
    id: `msg_${randomUUID()}`,
    role: 'user' as const,
    parts: [{ type: 'text' as const, text: promptText }],
  };

  const extraSystemPrompt =
    member.role === 'coordinator'
      ? buildCoordinatorSystemPrompt(swarm.id)
      : buildWorkerSystemPrompt({
          swarmId: swarm.id,
          memberName: member.name,
          parentName: member.parent,
          workspaceMode: member.workspaceMode,
          branch: member.branch,
          readOnly: member.workspaceMode === 'inherit',
        });

  return {
    threadId: member.threadId,
    providerType: member.providerType,
    ...(member.providerId ? { providerId: member.providerId } : {}),
    model: member.model,
    tools: resolveMemberTools(member, cfg, builtinTools),
    approvalPolicy: resolveMemberApprovalPolicy(member, cfg),
    extraSystemPrompt,
    workspaceSelection: memberWorkspaceSelection(member),
    messages: [...history, userMessage],
    runConfig: {
      kind: 'chat-turn' as const,
      metadata: {
        source: 'swarm',
        swarmId: swarm.id,
        swarmMember: member.name,
        swarmRole: member.role,
      },
    },
  };
};
