export type RelationshipScopeType = 'thread';

export type RelationshipSourceKind =
  | 'desktop-owner-thread'
  | 'napcat-private'
  | 'napcat-group'
  | 'external-client-thread'
  | 'unknown-thread';

export interface RelationshipStateRecord {
  id: string;
  profile_id: string;
  scope_type: RelationshipScopeType;
  scope_id: string;
  source_kind: RelationshipSourceKind;
  subject_label: string;
  relationship_summary: string;
  preferred_address: string;
  boundaries_json?: string | null;
  notes_json?: string | null;
  metadata?: string | null;
  last_interaction_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface RelationshipOwnerBaseline {
  owner_label: string;
  relationship_to_owner: string;
}

export interface RelationshipOverview {
  owner: RelationshipOwnerBaseline;
  recentStates: RelationshipStateRecord[];
}
