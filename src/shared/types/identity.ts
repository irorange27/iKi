export interface IdentityProfile {
  id: string;
  name: string;
  self_description: string;
  owner_name: string;
  relationship_to_owner: string;
  core_values: string | null;
  boundaries: string | null;
  tone_guidance: string;
  active: number; // 0 or 1
  metadata: string | null;
  created_at: string;
  updated_at: string;
}

