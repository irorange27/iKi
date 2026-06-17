import * as chatThreadDb from '../../../core/db/chat_thread';
import type { AffectState } from '../../../core/emotion/affect_state';
import { createLogger } from '../../../core/logger';
import {
  buildSkillsMetadataSystemPrompt,
  listSkills,
  normalizeSkillIds,
} from '../../../core/skills';
import { getToolModel } from '../../../core/provider/tool_model';
import { selectSkillsWithAgent } from '../../../core/provider/skill_selection';
import type { SkillSummary } from '../../../shared/types/skill';
import type { ChatInputMessage } from './types';
import { toLlmChatMessages } from './ui_messages';
import { getAutoPinnedSkillIds, recordAutoSkillSelection } from '../workflow/workflow_optimizer';

const chatSkillsLogger = createLogger({ module: 'chat_skills' });

export const resolveSkillsSystemPrompt = async (params: {
  inputMessages: ChatInputMessage[];
  threadId?: string;
  skillIds?: string[];
  skillMode?: 'manual' | 'auto';
  affectState?: AffectState | null;
}): Promise<{
  skillsSystemPrompt: string;
  usedSkills: SkillSummary[];
  skillMode: 'manual' | 'auto';
}> => {
  const skillMode = params.skillMode === 'auto' ? 'auto' : 'manual';
  const normalizedThreadId = typeof params.threadId === 'string' ? params.threadId.trim() : '';

  let pinnedSkillIds: string[] = [];
  let autoPinnedSkillIds: string[] = [];
  if (normalizedThreadId) {
    try {
      const thread = chatThreadDb.getChatThread(normalizedThreadId);
      if (thread?.skill_ids) {
        pinnedSkillIds = normalizeSkillIds(JSON.parse(thread.skill_ids));
      }
    } catch (error) {
      chatSkillsLogger.event({
        level: 'warn',
        event: 'chat.skills.thread_state_load',
        outcome: 'failed',
        error,
        entity: {
          thread_id: normalizedThreadId,
        },
      });
    }

    autoPinnedSkillIds = getAutoPinnedSkillIds(normalizedThreadId);
  }

  let normalizedSkillIds = normalizeSkillIds(params.skillIds);
  let availableSkills: SkillSummary[] = [];

  if (skillMode === 'manual') {
    // Manual mode: use explicit skills if provided, otherwise fall back to pinned thread skills.
    if (normalizedSkillIds.length === 0 && !Array.isArray(params.skillIds)) {
      normalizedSkillIds = pinnedSkillIds;
    }

    // Persist explicit selection (including empty array to clear pinned skills).
    if (normalizedThreadId && Array.isArray(params.skillIds)) {
      try {
        chatThreadDb.updateChatThread(normalizedThreadId, {
          skill_ids: JSON.stringify(normalizedSkillIds),
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
    // Auto mode: pick relevant skills per message using tool model, plus pinned thread skills.
    availableSkills = await listSkills();
    const availableSkillCatalog = availableSkills.map(skill => ({
      id: skill.id,
      name: skill.name,
      description: skill.description,
      source: skill.source,
    }));

    const toolModel = getToolModel();
    const autoSelectedSkillIds =
      toolModel && availableSkillCatalog.length > 0
        ? await selectSkillsWithAgent({
            messages: toLlmChatMessages(params.inputMessages),
            availableSkills: availableSkillCatalog,
            affectState: params.affectState,
          })
        : [];

    if (normalizedThreadId && toolModel && availableSkillCatalog.length > 0) {
      recordAutoSkillSelection({
        threadId: normalizedThreadId,
        availableSkillIds: availableSkillCatalog.map(skill => skill.id),
        selectedSkillIds: autoSelectedSkillIds,
      });
    }

    const union = new Set<string>();
    for (const id of pinnedSkillIds) union.add(id);
    for (const id of autoPinnedSkillIds) union.add(id);
    for (const id of autoSelectedSkillIds) union.add(id);
    normalizedSkillIds = Array.from(union);
  }

  if (availableSkills.length === 0 && normalizedSkillIds.length > 0) {
    availableSkills = await listSkills();
  }

  const skillsById = new Map(availableSkills.map(skill => [skill.id, skill] as const));
  const usedSkills = normalizedSkillIds
    .map(id => skillsById.get(id))
    .filter((skill): skill is SkillSummary => Boolean(skill));

  const skillsSystemPrompt = buildSkillsMetadataSystemPrompt(usedSkills);

  return { skillsSystemPrompt, usedSkills, skillMode };
};
