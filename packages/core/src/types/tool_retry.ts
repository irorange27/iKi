/**
 * Tool retry policy is declared once in the domain contract
 * (`../domain/tools` — schema is the source of truth, the type is its
 * `z.infer` projection). This module is the historical import path and re-exports
 * the projection so consumers do not have to know where the schema lives.
 */
export type { ToolRetryConfig } from '../domain/tools';
