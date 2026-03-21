import type { RelationshipOverview } from '../../shared/types/relationship';

type ElectronRelationshipApi = {
  getOverview?: (limit?: number) => Promise<RelationshipOverview>;
};

type WindowWithElectronApi = Window & {
  electronAPI?: {
    relationship?: ElectronRelationshipApi;
  };
};

const getWindow = (): WindowWithElectronApi | undefined => {
  if (typeof window === 'undefined') return undefined;
  return window as WindowWithElectronApi;
};

const getRelationshipApi = (): ElectronRelationshipApi | null => {
  const api = getWindow()?.electronAPI?.relationship;
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
