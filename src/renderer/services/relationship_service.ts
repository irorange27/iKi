import type { RelationshipOverview } from '../../shared/types/relationship';
import { requireElectronApiSlice } from './electron_api';

export const relationshipService = {
  async getOverview(limit = 8): Promise<RelationshipOverview> {
    const api = requireElectronApiSlice(
      'relationship',
      ['getOverview'],
      'window.electronAPI.relationship.getOverview is missing'
    );
    return api.getOverview(limit);
  },
};
