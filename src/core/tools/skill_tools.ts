import { z } from 'zod';

import {
  deletePersonalSkill,
  listPersonalSkills,
  readPersonalSkill,
  readSkillInstructions,
  writePersonalSkill,
} from '../skills';
import { BaseTool } from './base';
import { zodSchemaToJsonSchema } from './json_schema';
import { getToolRuntimeContext } from './runtime_context';
import {
  DEFAULT_PERSONAL_SKILL_LIST_LIMIT,
  DEFAULT_PERSONAL_SKILL_READ_MAX_CHARS,
  DeletePersonalSkillInputSchema,
  DeletePersonalSkillOutputSchema,
  ListPersonalSkillsInputSchema,
  ListPersonalSkillsOutputSchema,
  LoadSkillInputSchema,
  LoadSkillOutputSchema,
  MAX_PERSONAL_SKILL_LIST_LIMIT,
  MAX_PERSONAL_SKILL_READ_MAX_CHARS,
  MIN_PERSONAL_SKILL_READ_MAX_CHARS,
  ReadPersonalSkillInputSchema,
  ReadPersonalSkillOutputSchema,
  WritePersonalSkillInputSchema,
  WritePersonalSkillOutputSchema,
} from './schemas';

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

const clampListLimit = (limit: number): number =>
  Math.max(
    1,
    Math.min(MAX_PERSONAL_SKILL_LIST_LIMIT, Math.trunc(limit || DEFAULT_PERSONAL_SKILL_LIST_LIMIT))
  );

const clampReadMaxChars = (value: number): number =>
  Math.max(
    MIN_PERSONAL_SKILL_READ_MAX_CHARS,
    Math.min(
      MAX_PERSONAL_SKILL_READ_MAX_CHARS,
      Math.trunc(value || DEFAULT_PERSONAL_SKILL_READ_MAX_CHARS)
    )
  );

const matchesSkillQuery = (
  skill: { id: string; name: string; description: string; path?: string },
  query: string
): boolean => {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return [skill.id, skill.name, skill.description, skill.path || '']
    .join('\n')
    .toLowerCase()
    .includes(needle);
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

export class ListPersonalSkillsTool extends BaseTool {
  override name = 'list_personal_skills';
  override displayName = 'List Personal Skills';
  override type = 'function';
  override autoAllowed = true;
  override needsApproval = false;
  override description =
    'List the user-managed personal skills stored under the Personal skills folder. Use this before updating or deleting a personal skill so you can target the correct id.';
  override paramSchema = ListPersonalSkillsInputSchema;
  override outputSchema = zodSchemaToJsonSchema(ListPersonalSkillsOutputSchema, {
    title: 'list_personal_skills_output',
  });

  protected override async handler(args: z.infer<typeof this.paramSchema>) {
    const { rootPath, skills } = await listPersonalSkills({ forceRefresh: true });
    const filtered = skills
      .filter(skill => matchesSkillQuery(skill, args.query || ''))
      .slice(0, clampListLimit(args.limit));

    return {
      rootPath,
      skills: filtered,
      resultCount: filtered.length,
    };
  }
}

export class ReadPersonalSkillTool extends BaseTool {
  override name = 'read_personal_skill';
  override displayName = 'Read Personal Skill';
  override type = 'function';
  override autoAllowed = true;
  override needsApproval = false;
  override description =
    'Read the full SKILL.md content for a personal skill under the Personal skills folder.';
  override paramSchema = ReadPersonalSkillInputSchema;
  override outputSchema = zodSchemaToJsonSchema(ReadPersonalSkillOutputSchema, {
    title: 'read_personal_skill_output',
  });

  protected override async handler(args: z.infer<typeof this.paramSchema>) {
    const skill = await readPersonalSkill(args.id, {
      maxChars: clampReadMaxChars(args.maxChars),
    });
    if (!skill) {
      throw new Error(`Personal skill "${args.id}" not found`);
    }

    return skill;
  }
}

export class WritePersonalSkillTool extends BaseTool {
  override name = 'write_personal_skill';
  override displayName = 'Write Personal Skill';
  override type = 'function';
  override autoAllowed = true;
  override needsApproval = true;
  override approvalMode = 'always' as const;
  override description =
    'Create or replace a personal skill under the Personal skills folder. Only use this when the user explicitly asks to create or update a personal skill.';
  override paramSchema = WritePersonalSkillInputSchema;
  override outputSchema = zodSchemaToJsonSchema(WritePersonalSkillOutputSchema, {
    title: 'write_personal_skill_output',
  });

  protected override async handler(args: z.infer<typeof this.paramSchema>) {
    return await writePersonalSkill({
      id: args.id,
      ...(typeof args.skillName === 'string' ? { skillName: args.skillName } : {}),
      ...(typeof args.skillDescription === 'string'
        ? { skillDescription: args.skillDescription }
        : {}),
      instructions: args.instructions,
    });
  }
}

export class DeletePersonalSkillTool extends BaseTool {
  override name = 'delete_personal_skill';
  override displayName = 'Delete Personal Skill';
  override type = 'function';
  override autoAllowed = true;
  override needsApproval = true;
  override approvalMode = 'always' as const;
  override description =
    'Delete a personal skill from the Personal skills folder. Only use this when the user explicitly asks to remove that skill.';
  override paramSchema = DeletePersonalSkillInputSchema;
  override outputSchema = zodSchemaToJsonSchema(DeletePersonalSkillOutputSchema, {
    title: 'delete_personal_skill_output',
  });

  protected override async handler(args: z.infer<typeof this.paramSchema>) {
    return await deletePersonalSkill(args.id);
  }
}
