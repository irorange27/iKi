import fs from 'node:fs/promises';
import path from 'node:path';
import { once } from 'node:events';
import { initializeDatabase, closeDatabase } from '@iki/backend/db/database';
import { executeApprovedTool } from '@iki/backend/thread_session/tool_execution';
import { injectGetUserDataPath } from '@iki/backend/logger';

const [dbPath, root] = process.argv.slice(2);
injectGetUserDataPath(() => root!);
initializeDatabase({ dbPath });
process.send?.({ kind: 'ready' });
await once(process, 'message');
const outcome = await executeApprovedTool(
  { threadId: 'tool_thread', approvalId: 'tool_approval' },
  {
    signal: new AbortController().signal,
    execute: async () => {
      process.send?.({ kind: 'claimed' });
      await once(process, 'message');
      await fs.appendFile(path.join(root!, 'effects.txt'), 'effect\n');
      return 'actual result';
    },
  }
);
process.send?.({ kind: 'result', outcome });
closeDatabase();
process.disconnect();
