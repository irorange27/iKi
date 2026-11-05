/**
 * The skill vocabulary and descriptor live in the domain contract
 * (`../domain/tools` — `SkillSchema` is the single declaration, its shape is
 * exactly the summary iKi shows across IPC). This module keeps the historical
 * import path via re-exports.
 */
export type { SkillSource } from '../domain/tools';
export type { Skill as SkillSummary } from '../domain/tools';
