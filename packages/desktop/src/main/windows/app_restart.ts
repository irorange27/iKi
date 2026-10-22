import { app } from 'electron';

export type RelaunchDeps = {
  isPackaged: boolean;
  relaunch: () => void;
  quit: () => void;
};

const defaultDeps = (): RelaunchDeps => ({
  isPackaged: app.isPackaged,
  relaunch: () => app.relaunch(),
  quit: () => app.quit(),
});

export const shouldOfferRestart = (deps: Pick<RelaunchDeps, 'isPackaged'>): boolean =>
  !deps.isPackaged;

export const restartApp = (deps: RelaunchDeps = defaultDeps()): boolean => {
  if (!shouldOfferRestart(deps)) return false;
  deps.relaunch();
  deps.quit();
  return true;
};
