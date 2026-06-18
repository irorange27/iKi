type SkillFormatInput = {
  id: string;
  name?: string;
  description?: string;
  source?: string;
};

let _formatSkillMetadataForPrompt: ((skill: SkillFormatInput) => string) | null = null;

export function injectFormatSkillMetadataForPrompt(fn: (skill: SkillFormatInput) => string) {
  _formatSkillMetadataForPrompt = fn;
}

export function formatSkillMetadataForPrompt(skill: SkillFormatInput): string {
  if (!_formatSkillMetadataForPrompt) throw new Error('formatSkillMetadataForPrompt not injected');
  return _formatSkillMetadataForPrompt(skill);
}
