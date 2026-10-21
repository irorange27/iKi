
export type ContextCompositionCategory =
  | 'messages'
  | 'systemPrompt'
  | 'skills'
  | 'tools'
  | 'mcpTools'
  | 'other';

export type ContextCompositionSummary = {
  estimatedTotalTokens: number;
  categories: Partial<Record<ContextCompositionCategory, number>>;
};
