import { runMigrations } from './runner';
import { migration as migration001 } from './001_add_chat_tables';
import { migration as migration002 } from './002_add_workspaces_table';
import { migration as migration003 } from './003_add_prompt_apps_table';
import { migration as migration004 } from './004_add_memory_tables';
import { migration as migration005 } from './005_add_proactive_tasks_table';

// Register all migrations here
const migrations = [
  migration001,
  migration002,
  migration003,
  migration004,
  migration005,
  // Add more migrations here as needed
];

// Run all migrations on import
export const initializeMigrations = () => {
  runMigrations(migrations);
};
