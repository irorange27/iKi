import * as chatThreadDb from '../../../core/db/chat_thread';
import { buildSkillsSystemPrompt, listSkills, normalizeSkillIds } from '../../../core/skills';
import { getToolModel } from '../../../core/provider/tool_model';
import { selectSkillsWithAgent } from '../../../core/provider/skill_selection';
import type { ChatInputMessage } from './chat_types';
import { toLlmChatMessages } from './chat_ui';
import { getAutoPinnedSkillIds, recordAutoSkillSelection } from '../workflow/workflow_optimizer';

export const resolveSkillsSystemPrompt = async (params: {
  inputMessages: ChatInputMessage[];
  threadId?: string;
  skillIds?: string[];
  skillMode?: 'manual' | 'auto';
}): Promise<{ skillsSystemPrompt: string }> => {
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
      console.warn('[Main] Failed to resolve skill_ids from thread:', error);
    }

    autoPinnedSkillIds = getAutoPinnedSkillIds(normalizedThreadId);
  }

  let normalizedSkillIds = normalizeSkillIds(params.skillIds);

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
        console.warn('[Main] Failed to persist skill_ids for thread:', error);
      }
    }
  } else {
    // Auto mode: pick relevant skills per message using tool model, plus pinned thread skills.
    const availableSkillCatalog = (await listSkills()).map(skill => ({
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

  const skillsSystemPrompt =
    normalizedSkillIds.length > 0 ? await buildSkillsSystemPrompt(normalizedSkillIds) : '';

  return { skillsSystemPrompt };
};
