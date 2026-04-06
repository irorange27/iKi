export interface AssistantProfileRecord {
  id: string;
  profile_id: string;
  display_name: string;
  role_summary: string;
  owner_display_name: string;
  tone_guidance: string;
  hard_boundaries_json?: string | null;
  collaboration_style_json?: string | null;
  metadata_json?: string | null;
  created_at: string;
  updated_at: string;
}

export type ContinuityItemKind =
  | 'owner_fact'
  | 'preference'
  | 'boundary'
  | 'project'
  | 'person'
  | 'workflow_rule'
  | 'reference_note';

export type ContinuityItemStatus = 'candidate' | 'confirmed' | 'dismissed' | 'stale';

export type ContinuityItemScope = 'global' | 'project' | 'person' | 'workspace';

export type ContinuityItemSourceKind = 'manual' | 'explicit_message' | 'imported' | 'merged';

export interface ContinuityItemRecord {
  id: string;
  profile_id: string;
  kind: ContinuityItemKind;
  title: string;
  summary: string;
  status: ContinuityItemStatus;
  confidence: number;
  priority: number;
  scope: ContinuityItemScope;
  subject_key?: string | null;
  source_kind: ContinuityItemSourceKind;
  source_ref?: string | null;
  first_seen_at?: string | null;
  last_confirmed_at?: string | null;
  last_used_at?: string | null;
  metadata_json?: string | null;
  created_at: string;
  updated_at: string;
}

export interface ContinuityEvidenceRecord {
  id: string;
  item_id: string;
  thread_id?: string | null;
  message_id?: string | null;
  excerpt: string;
  extractor_version: string;
  created_at: string;
}

export interface ContinuitySearchResult extends ContinuityItemRecord {
  score: number;
  evidence_count: number;
}
