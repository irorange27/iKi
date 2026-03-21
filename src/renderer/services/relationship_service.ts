import type { RelationshipOverview } from '../../shared/types/relationship';
import type { ElectronApi } from '../../shared/types/electron_api';

type ElectronRelationshipApi = ElectronApi['relationship'];

const getRelationshipApi = (): ElectronRelationshipApi | null => {
  if (typeof window === 'undefined') return null;
  const api = window.electronAPI?.relationship;
  if (!api || typeof api.getOverview !== 'function') return null;
  return api;
};

export const relationshipService = {
  async getOverview(limit = 8): Promise<RelationshipOverview> {
    const api = getRelationshipApi();
    if (!api?.getOverview) {
      throw new Error('window.electronAPI.relationship.getOverview is missing');
    }
    return api.getOverview(limit);
  },
};
