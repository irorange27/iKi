import type { Migration } from './runner';
import { repairIdentityProfileForeignKeys } from './identity_profile_foreign_key_repair';

export const migration: Migration = {
  name: '032_repair_identity_profile_foreign_keys',
  up: () => {
    repairIdentityProfileForeignKeys();
  },
  down: () => {
    // Intentionally no-op. This migration only repairs broken foreign-key targets.
  },
};
