export interface IdentityProfile {
  id: string;
  name: string;
  self_description: string;
  owner_name: string;
  owner_role_description: string;
  core_values: string | null;
  boundaries: string | null;
  tone_guidance: string;
  active: number;
  metadata: string | null;
  created_at: string;
  updated_at: string;
}
