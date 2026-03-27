import { z } from 'zod';

import { readSkillInstructions } from '../skills';
import { BaseTool } from './base';
import { zodSchemaToJsonSchema } from './json_schema';
import { getToolRuntimeContext } from './runtime_context';
import { LoadSkillInputSchema, LoadSkillOutputSchema } from './schemas';

const MAX_SKILL_IDS_IN_ERROR = 8;

const formatSkillEnvelope = (params: {
  id: string;
  name: string;
  source: 'user' | 'codex';
  content: string;
  truncated: boolean;
}): string => {
  const trimmedContent = params.content.trim();
  const body = [
    `<skill id="${params.id}" name="${params.name}" source="${params.source}">`,
    trimmedContent,
    '</skill>',
  ];

  if (params.truncated) {
    body.push('[Skill content truncated]');
  }

  return body.join('\n');
};

export class LoadSkillTool extends BaseTool {
  override name = 'load_skill';
  override displayName = 'Load Skill';
  override type = 'function';
  override autoAllowed = false;
  override needsApproval = false;
  override description =
    'Load the full instructions for a skill that was already selected for this turn. Use the exact skill id from the skill metadata in the prompt.';
  override paramSchema = LoadSkillInputSchema;
  override outputSchema = zodSchemaToJsonSchema(LoadSkillOutputSchema, {
    title: 'load_skill_output',
  });

  protected override async handler(args: z.infer<typeof this.paramSchema>) {
    const allowedSkillIds = (getToolRuntimeContext().availableSkillIds || [])
      .map(id => (typeof id === 'string' ? id.trim() : ''))
      .filter(Boolean);

    if (allowedSkillIds.length === 0) {
      throw new Error('No skills are enabled for this turn');
    }

    if (!allowedSkillIds.includes(args.id)) {
      const available = allowedSkillIds.slice(0, MAX_SKILL_IDS_IN_ERROR).join(', ');
      throw new Error(
        `Skill "${args.id}" is not enabled for this turn. Available skill ids: ${available}`
      );
    }

    const skill = await readSkillInstructions(args.id);
    if (!skill) {
      throw new Error(`Skill "${args.id}" not found`);
    }

    return {
      id: skill.id,
      name: skill.name,
      source: skill.source,
      content: formatSkillEnvelope({
        id: skill.id,
        name: skill.name,
        source: skill.source,
        content: skill.content,
        truncated: skill.truncated,
      }),
      truncated: skill.truncated,
    };
  }
}
