import { app } from 'electron';
import path from 'node:path';

import { createLogger } from '@iki/backend/logger';

const logger = createLogger({ module: 'dev_dock_icon' });

export const setDevDockIcon = (): void => {
  if (process.platform !== 'darwin' || app.isPackaged) {
    return;
  }
  const iconPath = path.join(app.getAppPath(), 'assets', 'icon', 'iki-icon.png');
  app.dock?.setIcon(iconPath);
  logger.event({
    level: 'info',
    event: 'dev_dock_icon.set',
    message: 'Dev dock icon applied',
    data: { icon_path: iconPath },
  });
};
