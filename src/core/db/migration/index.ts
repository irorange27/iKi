import { runMigrations } from './runner';
import { migration as migration001 } from './001_add_chat_tables';
import { migration as migration002 } from './002_add_workspaces_table';
import { migration as migration003 } from './003_add_prompt_apps_table';
import { migration as migration004 } from './004_add_memory_tables';
import { migration as migration005 } from './005_add_proactive_tasks_table';
import { migration as migration006 } from './006_add_app_clients_table';
import { migration as migration007 } from './007_add_emotion_events_table';
import { migration as migration008 } from './008_add_workflow_profiles_table';
import { migration as migration009AffectStates } from './009_add_affect_states_table';
import { migration as migration010McpServers } from './010_add_mcp_servers_table';
import { migration as migration011ProactiveCron } from './011_add_proactive_tasks_cron';
import { migration as migration012ChatToolApprovals } from './012_add_chat_tool_approval_tables';
import { migration as migration013ChatUsage } from './013_add_chat_usage_table';
import { migration as migration014ThreadContext } from './014_add_chat_thread_context_table';
import { migration as migration015ProactiveTaskToolMode } from './015_add_proactive_task_tool_mode';
import { migration as migration016TodoLists } from './016_add_todo_lists_table';
import { migration as migration017IdentityProfiles } from './017_add_identity_profiles_table';
import { migration as migration018LifeRuntime } from './018_add_life_runtime_tables';
import { migration as migration019LifeReflections } from './019_add_life_reflections_table';
import { migration as migration020RelationshipStates } from './020_add_relationship_states_table';
import { migration as migration021ChatToolApprovalSkillIds } from './021_add_chat_tool_approval_skill_ids';
import { migration as migration022ChatToolApprovalMaxOutputTokens } from './022_add_chat_tool_approval_max_output_tokens';
import { migration as migration023CanonicalizeChatUiMessages } from './023_canonicalize_chat_ui_messages';
import { migration as migration024AddProviderModelOptions } from './024_add_provider_model_options';
import { migration as migration025AddChatThreadTodos } from './025_add_chat_thread_todos_table';

// Register all migrations here
export const registeredMigrations = [
  migration001,
  migration002,
  migration003,
  migration004,
  migration005,
  migration006,
  migration007,
  migration008,
  migration009AffectStates,
  migration010McpServers,
  migration011ProactiveCron,
  migration012ChatToolApprovals,
  migration013ChatUsage,
  migration014ThreadContext,
  migration015ProactiveTaskToolMode,
  migration016TodoLists,
  migration017IdentityProfiles,
  migration018LifeRuntime,
  migration019LifeReflections,
  migration020RelationshipStates,
  migration021ChatToolApprovalSkillIds,
  migration022ChatToolApprovalMaxOutputTokens,
  migration023CanonicalizeChatUiMessages,
  migration024AddProviderModelOptions,
  migration025AddChatThreadTodos,
  // Add more migrations here as needed
];

// Run all migrations on import
export const initializeMigrations = () => {
  runMigrations(registeredMigrations);
};
