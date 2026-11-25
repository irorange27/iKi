import type { SwarmToolSettings } from '@iki/core/domain/settings';
import type { ChatService } from '../thread_session/service';
import type { ActorState, ThreadMailbox } from '../thread_session/mailbox';
import type { WorkspaceIsolationMode } from '../workspaces/git_worktree';

export type SwarmWorkspaceMode = WorkspaceIsolationMode;

export type SwarmMemberStatus = ActorState;

export type SwarmBoardEntryKind = 'brief' | 'post' | 'system';

export type SwarmBoardEntry = {
  seq: number;
  swarmId: string;
  createdAt: string;
  sender: string;
  mentions: string[];
  kind: SwarmBoardEntryKind;
  content: string;
};

export type SwarmMemberRecord = {
  name: string;
  threadId: string;
  role: 'coordinator' | 'worker';
  parent: string | null;
  workspaceMode: SwarmWorkspaceMode;
  workspacePath: string | null;
  workspaceId: string | null;
  repoRoot: string | null;
  branch: string | null;
  providerType: string;
  providerId?: string;
  model: string;
  status: SwarmMemberStatus;
  lastReadSeq: number;
  turnsUsed: number;
  createdAt: string;
  updatedAt: string;
  killedAt?: string;
};

export type SwarmRecord = {
  id: string;
  title: string;
  coordinatorThreadId: string;
  createdAt: string;
  updatedAt: string;
  totalTurns: number;
  pingPongHops: number;
  members: Record<string, SwarmMemberRecord>;
};

export type SwarmMemberStatusView = {
  name: string;
  threadId: string;
  role: 'coordinator' | 'worker';
  parent: string | null;
  status: SwarmMemberStatus;
  model: string;
  providerType: string;
  providerId?: string;
  workspaceMode: SwarmWorkspaceMode;
  workspacePath: string | null;
  branch: string | null;
  turnsUsed: number;
  pendingEvents: number;
  unreadSeqCount: number;
};

export type SwarmStatusView = {
  swarmId: string;
  title: string;
  totalTurns: number;
  maxTotalTurns: number;
  latestSeq: number;
  members: SwarmMemberStatusView[];
};

export type SwarmModelOption = {
  providerId: string;
  providerType: string;
  model: string;
  qualified: string;
};

export type SwarmAddParams = {
  callerThreadId: string;
  name: string;
  brief: string;
  workspace?: SwarmWorkspaceMode;
  model?: string;
  fork?: string;
  n?: number;
  tasks?: string[];
};

export type SwarmPostParams = {
  callerThreadId: string;
  message: string;
};

export type SwarmModelParams = {
  callerThreadId: string;
  name?: string;
  model: string;
  reason?: string;
};

export type SwarmKillParams = {
  callerThreadId: string;
  name: string;
  deleteBranch?: boolean;
};

export type SwarmTitleParams = {
  callerThreadId: string;
  title: string;
};

export type SwarmStatusParams = {
  callerThreadId: string;
};

export type SwarmModelsParams = {
  callerThreadId: string;
  all?: boolean;
};

export type SwarmManagerDeps = {
  chatService: ChatService;
  mailbox?: ThreadMailbox;
  getSettings?: () => Partial<SwarmToolSettings> | null | undefined;
  getBuiltinTools?: () => readonly string[];
  onCoordinatorWake?: (params: {
    swarmId: string;
    coordinatorThreadId: string;
    entries: ReadonlyArray<SwarmBoardEntry>;
  }) => boolean | void;
};
