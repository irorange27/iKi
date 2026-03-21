import { ipcMain } from 'electron';

import { toIpcSerializable } from '../../shared/utils/ipc_serialization';
import { getRelationshipOverview } from '../services/relationship/relationship_service';

let relationshipIpcRegistered = false;

export const registerRelationshipIpc = (): void => {
  if (relationshipIpcRegistered) return;
  relationshipIpcRegistered = true;

  ipcMain.handle('relationship:get-overview', (_event, limit?: number) =>
    toIpcSerializable(getRelationshipOverview(limit))
  );
};
