export type SkillSource = 'user' | 'codex';

export interface SkillSummary {
  /**
   * Stable identifier used for selection/persistence.
   * Example: "codex:.system/openai-docs" or "user:my-skill".
   */
  id: string;
  name: string;
  description: string;
  source: SkillSource;
  /**
   * Built-in tools that must be available before the skill's workflow is usable.
   * These are treated as declarative runtime requirements, not prompt instructions.
   */
  requiredTools?: string[];
  /**
   * Absolute folder path containing SKILL.md (for UI display only).
   */
  path?: string;
}
