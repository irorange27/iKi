import { runMigrations } from './runner';
import { migration as migration001 } from './001_add_chat_tables';
import { migration as migration002 } from './002_add_workspaces_table';
import { migration as migration003 } from './003_add_prompt_apps_table';
import { migration as migration004 } from './004_add_memory_tables';
import { migration as migration005 } from './005_add_proactive_tasks_table';
import { migration as migration006 } from './006_add_app_clients_table';
import { migration as migration007 } from './007_add_emotion_events_table';
import { migration as migration008 } from './008_add_workflow_profiles_table';
import { migration as migration009McpServers } from './009_add_mcp_servers_table';
import { migration as migration009AffectStates } from './009_add_affect_states_table';
import { migration as migration010ProactiveCron } from './010_add_proactive_tasks_cron';
import { migration as migration011ChatToolApprovals } from './011_add_chat_tool_approval_tables';

// Register all migrations here
const migrations = [
  migration001,
  migration002,
  migration003,
  migration004,
  migration005,
  migration006,
  migration007,
  migration008,
  migration009McpServers,
  migration009AffectStates,
  migration010ProactiveCron,
  migration011ChatToolApprovals,
  // Add more migrations here as needed
];

// Run all migrations on import
export const initializeMigrations = () => {
  runMigrations(migrations);
};
