import * as chatThreadDb from '@iki/backend/db/chat_thread';
import { createLogger } from '@iki/backend/logger';
import {
  buildSkillsMetadataSystemPrompt,
  formatSkillMetadataForPrompt,
  listSkills,
  normalizeSkillIds,
} from '@iki/backend/tools/skills';
import { getToolModel } from '../provider/tool_model';
import { selectSkillsWithAgent } from '../provider/skill_selection';
import type { SkillSummary } from '@iki/backend/types/skill';
import type { ChatInputMessage } from './types';
import { toLlmChatMessages } from '@iki/backend/message/ui_messages';

const chatSkillsLogger = createLogger({ module: 'chat_skills' });

export const resolveSkillsSystemPrompt = async (params: {
  inputMessages: ChatInputMessage[];
  threadId?: string;
  skillIds?: string[];
  skillMode?: 'manual' | 'auto';
}): Promise<{
  skillsSystemPrompt: string;
  usedSkills: SkillSummary[];
  skillMode: 'manual' | 'auto';
}> => {
  const skillMode = params.skillMode === 'auto' ? 'auto' : 'manual';
  const normalizedThreadId = typeof params.threadId === 'string' ? params.threadId.trim() : '';

  let pinnedSkillIds: string[] = [];
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
  }

  let normalizedSkillIds = normalizeSkillIds(params.skillIds);
  let availableSkills: SkillSummary[] = [];

  if (skillMode === 'manual') {

    if (normalizedSkillIds.length === 0 && !Array.isArray(params.skillIds)) {
      normalizedSkillIds = pinnedSkillIds;
    }

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

    availableSkills = await listSkills();
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
    availableSkills = await listSkills();
  }

  const skillsById = new Map(availableSkills.map(skill => [skill.id, skill] as const));
  const usedSkills = normalizedSkillIds
    .map(id => skillsById.get(id))
    .filter((skill): skill is SkillSummary => Boolean(skill));

  const skillsSystemPrompt = buildSkillsMetadataSystemPrompt(usedSkills);

  return { skillsSystemPrompt, usedSkills, skillMode };
};
