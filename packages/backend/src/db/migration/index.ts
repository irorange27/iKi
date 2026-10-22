import type { SqliteDatabase } from '../sqlite';
import {
  isMigrationExecuted,
  markMigrationExecuted,
  runMigrations,
  type Migration,
} from './runner';
import { migration as baseline } from './001_baseline';
import { migration as renameChatToolApprovals } from './002_rename_chat_tool_approvals';
import { migration as approvalSessionWorkspaceSelection } from './003_approval_session_workspace_selection';
import { migration as approvalSessionPlan } from './004_approval_session_plan';
import { migration as dropMemoryAndAffect } from './005_drop_memory_and_affect';
import { migration as dropThreadContext } from './006_drop_thread_context';
import { migration as dropDeadTables } from './007_drop_dead_tables';
import { migration as dropClipboardSnapshots } from './008_drop_clipboard_snapshots';
import { migration as indexConversationReadPaths } from './009_index_conversation_read_paths';
import { migration as dropChatMessages } from './010_drop_chat_messages';
import { migration as dropContinuity } from './011_drop_continuity';
import { migration as dropIdentityProfiles } from './012_drop_identity_profiles';
import { migration as dropAwaiterWakeEvents } from './013_drop_awaiter_wake_events';
import { migration as dropTodoTables } from './014_drop_todo_tables';
import { migration as dropToolCallApprovalTables } from './015_drop_tool_call_approval_tables';

export const registeredMigrations: Migration[] = [
  baseline,
  renameChatToolApprovals,
  approvalSessionWorkspaceSelection,
  approvalSessionPlan,
  dropMemoryAndAffect,
  dropThreadContext,
  dropDeadTables,
  dropClipboardSnapshots,
  indexConversationReadPaths,
  dropChatMessages,
  dropContinuity,
  dropIdentityProfiles,
  dropAwaiterWakeEvents,
  dropTodoTables,
  dropToolCallApprovalTables,
];

export const initializeMigrations = (db: SqliteDatabase) => {

  const hasPreBaselineSchema = Boolean(
    db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT IN ('config', 'providers', 'thread_run_locks', 'session_events', 'migrations') LIMIT 1"
      )
      .get()
  );

  if (hasPreBaselineSchema && !isMigrationExecuted(db, baseline.name)) {
    runMigrations(db, []);
    markMigrationExecuted(db, baseline.name);
  }

  runMigrations(db, registeredMigrations);
};
