export type WorkflowOptimizationConfig = {
  enabled: boolean;
  autoPinSkills: boolean;
  minAutoSkillRuns: number;
  minSkillSelections: number;
  pinConfidence: number;
  unpinConfidence: number;
  maxPinnedSkills: number;
};

export type WorkflowProfile = {
  version: 1;
  stats: {
    autoSkillRuns: number;
  };
  skills: Record<
    string,
    {
      selections: number;
      lastSelectedAt?: string;
    }
  >;
  pinnedSkills: string[];
};
