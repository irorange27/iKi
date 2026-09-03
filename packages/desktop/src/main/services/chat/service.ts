import * as fs from 'node:fs';
import { dialog } from 'electron';

import { createChatService } from '@iki/backend/thread_session';
import type { ChatServicePlatformDeps } from '@iki/backend/chat_platform';
import { companionService } from '../companion/companion_service';
import { getClipboardContextMessage } from '../context/clipboard_monitor';
import {
  getAssistantProfileContextMessage,
  retrieveRelevantContinuity,
  onMessagePersisted as onContinuityMessagePersisted,
} from '../continuity/continuity_service';
import {
  getAutoPinnedSkillIds,
  recordAutoSkillSelection,
} from '../workflow/workflow_optimizer';
import * as agentRunDb from '@iki/backend/db/agent_runs';
import * as agentEvalDb from '@iki/backend/db/agent_eval';
import { toIsoNow } from '@iki/backend/utils/text';
import type { EvalExportPayload } from '@iki/backend/types/agent_run';

export type { ChatStreamTarget, ChatService } from '@iki/backend/thread_session';

const platformDeps: ChatServicePlatformDeps = {
  companion: companionService,
  exportTrace: async (runId: string) => {
    const trace = agentRunDb.getAgentRunTrace(runId);
    if (!trace) return { success: false, error: 'Run not found' };

    const labels = agentEvalDb.listEvalLabelsByRun(runId);
    const payload: EvalExportPayload = {
      exportedAt: toIsoNow(),
      version: '1',
      trace,
      labels,
    };

    const result = await dialog.showSaveDialog({
      title: 'Export Agent Run Trace',
      defaultPath: `agent-trace-${runId}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });

    if (result.canceled || !result.filePath) {
      return { success: false, error: 'cancelled' };
    }

    try {
      fs.writeFileSync(result.filePath, JSON.stringify(payload, null, 2), 'utf-8');
      return { success: true, filePath: result.filePath };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  },
  getClipboardContextMessage,
  getAssistantProfileContextMessage,
  retrieveRelevantContinuity,
  onMessagePersisted: onContinuityMessagePersisted,
  getAutoPinnedSkillIds,
  recordAutoSkillSelection,
};

export const chatService = createChatService(platformDeps);
