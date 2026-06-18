export interface PlanStep {
  id: string;
  description: string;
  expectedOutput: string;
  dependsOn: string[];
  suggestedTools: string[];
  strategy?: string;
}

export interface Plan {
  steps: PlanStep[];
  overallStrategy: string;
}
