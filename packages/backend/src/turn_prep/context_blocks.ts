import fs from 'node:fs';
import path from 'node:path';

import { getThreadWorkspaceSelection } from '@iki/backend/workspaces/thread_workspace';
import type { ModelCapability } from '@iki/backend/utils/provider_models';
import { getPromptFromMessage } from '@iki/backend/message/ui_messages';
import type { ContextConfig, IdentityContext, SkillContext } from './context_types';
import { buildDroppedBlock, clipTextToTokenBudget, estimateTextTokens } from './context_helpers';
import type { ChatInputMessage } from '@iki/backend/message/chat_message_types';

const AGENT_INSTRUCTIONS_FILENAMES = ['AGENTS.md', 'IKI.md'];

const stripHtmlComments = (value: string): string => value.replace(/<!--[\s\S]*?-->/g, '');

const hasMeaningfulContent = (value: string): boolean => {
  const stripped = stripHtmlComments(value).trim();
  return stripped.length > 0;
};

export const readAgentInstructionsForSelection = (
  selection: import('../workspaces/thread_workspace').ThreadWorkspaceSelection | null | undefined
): string => {
  if (!selection) return '';

  const workspacePath = selection.workspace?.path;
  if (!workspacePath) return '';

  try {
    const filename = AGENT_INSTRUCTIONS_FILENAMES.find(name =>
      fs.existsSync(path.join(workspacePath, name))
    );
    if (!filename) return '';
    const filePath = path.join(workspacePath, filename);
    const raw = fs.readFileSync(filePath, 'utf8');
    const cleaned = stripHtmlComments(raw).trim();
    if (!hasMeaningfulContent(cleaned)) return '';
    return [`Project agent instructions (from ${filename}):`, cleaned].join('\n');
  } catch {
    return '';
  }
};

export const readAgentInstructions = (threadId?: string): string => {
  if (!threadId) return '';
  return readAgentInstructionsForSelection(getThreadWorkspaceSelection(threadId));
};

export const buildIdentityContext = (
  workspaceSystemMessage: ((threadId?: string) => string) | undefined,
  threadId: string | undefined,
  contextConfig: ContextConfig,
  modelCapability: ModelCapability | null | undefined,
  agentInstructions: string
): IdentityContext => {

  const identityText = [
    workspaceSystemMessage?.(threadId)?.trim() ?? '',
    agentInstructions?.trim() ?? '',
  ]
    .filter(Boolean)
    .join('\n\n');
  const identityClip = {
    text: clipTextToTokenBudget(identityText, contextConfig.maxIdentityTokens).text,
    truncated: clipTextToTokenBudget(identityText, contextConfig.maxIdentityTokens).truncated,
  };

  return {
    systemMessage: identityClip.text,
    block: {
      kind: 'identity',
      status: identityClip.text ? (identityClip.truncated ? 'truncated' : 'included') : 'dropped',
      estimatedTokens: estimateTextTokens(identityClip.text),
      charCount: identityClip.text.length,
      ...(identityClip.text
        ? identityClip.truncated
          ? { reason: 'identity block clipped to context budget' }
          : {}
        : { reason: 'no active identity profile or workspace scope available' }),
    },
  };
};

export const buildSkillContext = async (params: {
  inputMessages: ChatInputMessage[];
  threadId?: string;
  skillIds?: string[];
  skillMode?: 'manual' | 'auto';
  contextConfig: ContextConfig;
  modelCapability?: ModelCapability | null;
  resolveSkillsSystemPrompt: typeof import('../thread_session/skills').resolveSkillsSystemPrompt;
}): Promise<SkillContext> => {
  const { skillsSystemPrompt, usedSkills, skillMode } = await params.resolveSkillsSystemPrompt({
    inputMessages: params.inputMessages,
    threadId: params.threadId,
    skillIds: params.skillIds,
    skillMode: params.skillMode,
  });
  const skillClip = clipTextToTokenBudget(skillsSystemPrompt, params.contextConfig.maxSkillTokens);

  return {
    systemMessage: skillClip.text,
    usedSkills,
    skillMode,
    block: {
      kind: 'skills',
      status: skillClip.text ? (skillClip.truncated ? 'truncated' : 'included') : 'dropped',
      estimatedTokens: estimateTextTokens(skillClip.text),
      charCount: skillClip.text.length,
      ...(skillClip.text
        ? skillClip.truncated
          ? { reason: 'skill context clipped to budget' }
          : {}
        : { reason: 'no skills selected' }),
      sourceCount: usedSkills.length,
    },
  };
};

export { buildDroppedBlock };
