import * as chatThreadDb from '@iki/store/chat_thread';
import { createLogger } from '@iki/core/logger';
import {
  buildSkillsMetadataSystemPrompt,
  formatSkillMetadataForPrompt,
  listSkills,
  normalizeSkillIds,
} from '@iki/harness/tools/skills';
import {
  buildSkillsDeltaReminderText,
  computeSkillFingerprints,
  diffSkillsAgainstSnapshot,
  hasSkillsDelta,
} from '@iki/harness/tools/skills_delta';
import { getToolModel } from '@iki/llm-pi-ai/tool_model';
import { selectSkillsWithAgent } from '@iki/llm-pi-ai/skill_selection';
import type { ThreadSkillReminderAnchor, ThreadSkillsSnapshot } from '@iki/core/types/chat';
import type { SkillSummary } from '@iki/core/types/skill';
import type { ChatInputMessage } from './types';
import { toLlmChatMessages } from '@iki/llm/message/ui_messages';

const chatSkillsLogger = createLogger({ module: 'chat_skills' });

export const resolveSkillsSystemPrompt = async (params: {
  inputMessages: ChatInputMessage[];
  threadId?: string;
  workspacePath?: string;
  skillIds?: string[];
  skillMode?: 'manual' | 'auto';
  currentUserAnchor?: string;
}): Promise<{
  skillsSystemPrompt: string;
  usedSkills: SkillSummary[];
  skillMode: 'manual' | 'auto';
  anchoredReminders?: ThreadSkillReminderAnchor[];
}> => {
  const skillMode = params.skillMode === 'auto' ? 'auto' : 'manual';
  const normalizedThreadId = typeof params.threadId === 'string' ? params.threadId.trim() : '';
  const threadRow = normalizedThreadId ? chatThreadDb.getChatThread(normalizedThreadId) : null;

  // Pinned skills are a row field now — no parse step, no parse failures.
  const pinnedSkillIds = normalizeSkillIds(threadRow?.skill_ids ?? []);

  let normalizedSkillIds = normalizeSkillIds(params.skillIds);
  let availableSkills: SkillSummary[] = [];

  if (skillMode === 'manual') {
    if (normalizedSkillIds.length === 0 && !Array.isArray(params.skillIds)) {
      normalizedSkillIds = pinnedSkillIds;
    }

    if (normalizedThreadId && Array.isArray(params.skillIds)) {
      try {
        chatThreadDb.updateChatThread(normalizedThreadId, {
          skill_ids: normalizedSkillIds,
        });
      } catch (error) {
        chatSkillsLogger.event({
          level: 'warn',
          event: 'chat.skills.thread_state_persist',
          outcome: 'failed',
          error,
          entity: {
            thread_id: normalizedThreadId,
          },
        });
      }
    }
  } else {
    availableSkills = await listSkills({ forceRefresh: true, workspacePath: params.workspacePath });
    const availableSkillCatalog = availableSkills.map(skill => ({
      id: skill.id,
      name: skill.name,
      description: skill.description,
      source: skill.source,
    }));

    const toolModel = getToolModel();

    const autoSelectedSkillIds =
      (toolModel && availableSkillCatalog.length > 0
        ? await selectSkillsWithAgent({
            messages: toLlmChatMessages(params.inputMessages),
            availableSkills: availableSkillCatalog,
            formatCatalogItem: formatSkillMetadataForPrompt,
          })
        : null) ?? [];

    const union = new Set<string>();
    for (const id of pinnedSkillIds) union.add(id);
    for (const id of autoSelectedSkillIds) union.add(id);
    normalizedSkillIds = Array.from(union);
  }

  if (availableSkills.length === 0 && normalizedSkillIds.length > 0) {
    availableSkills = await listSkills({ forceRefresh: true, workspacePath: params.workspacePath });
  }

  const skillsById = new Map(availableSkills.map(skill => [skill.id, skill] as const));
  const usedSkills = normalizedSkillIds
    .map(id => skillsById.get(id))
    .filter((skill): skill is SkillSummary => Boolean(skill));

  const currentPrompt = buildSkillsMetadataSystemPrompt(usedSkills);

  if (!normalizedThreadId || !threadRow) {
    return { skillsSystemPrompt: currentPrompt, usedSkills, skillMode, anchoredReminders: [] };
  }

  const currentFingerprints = computeSkillFingerprints(usedSkills);
  const existingSnapshot = threadRow.skills_snapshot;

  if (!existingSnapshot) {
    const initialSnapshot: ThreadSkillsSnapshot = {
      baselinePrompt: currentPrompt,
      lastDelivered: currentFingerprints,
      anchoredReminders: [],
    };
    try {
      chatThreadDb.updateChatThread(normalizedThreadId, { skills_snapshot: initialSnapshot });
    } catch (error) {
      chatSkillsLogger.event({
        level: 'warn',
        event: 'chat.skills.snapshot_persist',
        outcome: 'failed',
        error,
        entity: { thread_id: normalizedThreadId },
      });
    }
    return { skillsSystemPrompt: currentPrompt, usedSkills, skillMode, anchoredReminders: [] };
  }

  // Keep the leading systemPrompt frozen to Turn 1's baselinePrompt so KV-cache
  // prefix stays byte-identical; deliver any subsequent edits or auto-selection
  // changes via an anchored tail `<system_reminder name="skills">`.
  const anchoredReminders = [...(existingSnapshot.anchoredReminders ?? [])];
  const delta = diffSkillsAgainstSnapshot(
    existingSnapshot.lastDelivered ?? {},
    usedSkills,
    currentFingerprints
  );

  if (hasSkillsDelta(delta)) {
    const reminderText = buildSkillsDeltaReminderText(delta);
    const anchor = params.currentUserAnchor?.trim();
    if (reminderText && anchor) {
      const existingIdx = anchoredReminders.findIndex(item => item.beforeAnchor === anchor);
      if (existingIdx >= 0) {
        anchoredReminders[existingIdx] = { beforeAnchor: anchor, text: reminderText };
      } else {
        anchoredReminders.push({ beforeAnchor: anchor, text: reminderText });
      }
    }
    const nextSnapshot: ThreadSkillsSnapshot = {
      baselinePrompt: existingSnapshot.baselinePrompt,
      lastDelivered: currentFingerprints,
      anchoredReminders,
    };
    try {
      chatThreadDb.updateChatThread(normalizedThreadId, { skills_snapshot: nextSnapshot });
    } catch (error) {
      chatSkillsLogger.event({
        level: 'warn',
        event: 'chat.skills.snapshot_persist',
        outcome: 'failed',
        error,
        entity: { thread_id: normalizedThreadId },
      });
    }
  }

  return {
    skillsSystemPrompt: existingSnapshot.baselinePrompt,
    usedSkills,
    skillMode,
    anchoredReminders,
  };
};
