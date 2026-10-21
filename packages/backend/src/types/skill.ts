export type SkillSource = 'user' | 'codex';

export interface SkillSummary {

  id: string;
  name: string;
  description: string;
  source: SkillSource;

  requiredTools?: string[];

  path?: string;
}
