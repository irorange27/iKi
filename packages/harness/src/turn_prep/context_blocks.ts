import fs from 'node:fs';
import path from 'node:path';

import { getThreadWorkspaceSelection } from '@iki/harness/workspaces/thread_workspace';
import type { ContextConfig, IdentityContext, SkillContext } from './context_types';
import { buildDroppedBlock, clipTextToTokenBudget, estimateTextTokens } from './context_helpers';
import type { ChatInputMessage } from '@iki/llm/message/chat_message_types';

const AGENT_INSTRUCTIONS_FILENAMES = ['AGENTS.md', 'AGENT.md', 'IKI.md'];

const stripHtmlComments = (value: string): string => value.replace(/<!--[\s\S]*?-->/g, '');

const hasMeaningfulContent = (value: string): boolean => {
  const stripped = stripHtmlComments(value).trim();
  return stripped.length > 0;
};

export type InspectedAgentInstructions = {
  filePath: string;
  filename: string;
  content: string;
  lineCount: number;
  charCount: number;
};

export const inspectAgentInstructionsForWorkspace = (
  workspacePath: string | null | undefined
): InspectedAgentInstructions | null => {
  if (!workspacePath) return null;
  try {
    const filename = AGENT_INSTRUCTIONS_FILENAMES.find(name =>
      fs.existsSync(path.join(workspacePath, name))
    );
    if (!filename) return null;
    const filePath = path.join(workspacePath, filename);
    const raw = fs.readFileSync(filePath, 'utf8');
    const cleaned = stripHtmlComments(raw).trim();
    if (!hasMeaningfulContent(cleaned)) return null;
    return {
      filePath,
      filename,
      content: cleaned,
      lineCount: cleaned.split(/\r?\n/).length,
      charCount: cleaned.length,
    };
  } catch {
    return null;
  }
};

export const readAgentInstructionsForSelection = (
  selection: import('../workspaces/thread_workspace').ThreadWorkspaceSelection | null | undefined
): string => {
  if (!selection) return '';
  const inspected = inspectAgentInstructionsForWorkspace(selection.workspace?.path);
  if (!inspected) return '';
  return [`Project agent instructions (from ${inspected.filename}):`, inspected.content].join('\n');
};

export const readAgentInstructions = (threadId?: string): string => {
  if (!threadId) return '';
  return readAgentInstructionsForSelection(getThreadWorkspaceSelection(threadId));
};

export const buildIdentityContext = (
  workspaceSystemMessage: ((threadId?: string) => string) | undefined,
  threadId: string | undefined,
  contextConfig: ContextConfig,
  agentInstructions: string
): IdentityContext & { runtimeWorkspaceText: string } => {
  const runtimeWorkspaceText = workspaceSystemMessage?.(threadId)?.trim() ?? '';
  const instructionsClip = clipTextToTokenBudget(
    agentInstructions?.trim() ?? '',
    contextConfig.maxIdentityTokens
  );
  const totalText = [runtimeWorkspaceText, instructionsClip.text].filter(Boolean).join('\n\n');

  return {
    systemMessage: instructionsClip.text,
    runtimeWorkspaceText,
    block: {
      kind: 'identity',
      status: totalText ? (instructionsClip.truncated ? 'truncated' : 'included') : 'dropped',
      estimatedTokens: estimateTextTokens(totalText),
      charCount: totalText.length,
      ...(totalText
        ? instructionsClip.truncated
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
