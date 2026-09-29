/** Categories displayed in the renderer's context-usage panel. */
export type ContextCompositionCategory =
  | 'messages'
  | 'systemPrompt'
  | 'skills'
  | 'memory'
  | 'tools'
  | 'mcpTools'
  | 'other';

/**
 * Estimated per-category token breakdown of one turn's assembled context.
 * Category values come from the local tokenizer; only provider-reported usage
 * totals are exact, so consumers must treat this as an estimate.
 */
export type ContextCompositionSummary = {
  estimatedTotalTokens: number;
  categories: Partial<Record<ContextCompositionCategory, number>>;
};
