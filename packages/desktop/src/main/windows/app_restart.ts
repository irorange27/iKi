import { app } from 'electron';

/**
 * Restart the app in place — the one thing a renderer reload cannot do.
 *
 * Renderer edits hot-reload (Vite HMR in `app:dev`/`app:debug`). Main-process
 * edits (`main.ts`, `main/ipc/*`, backend code the main process imports) are
 * only picked up by a new process. Without this, "I changed the code" meant
 * quitting, finding the terminal, and running `pnpm run app:dev` again.
 *
 * Dev-only on purpose: in the packaged app a "relaunch" is just a relaunch and
 * offers nothing the user cannot do with Cmd+Q, so the menu item is omitted.
 */
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

/**
 * True when a restart would actually pick up new code. `electron-forge start`
 * runs the app's TypeScript through a watcher that rebuilds `.vite/build` and
 * restarts Electron itself; a manual relaunch there is still correct, it just
 * races the watcher, so the menu entry says so in its label.
 */
export const shouldOfferRestart = (deps: Pick<RelaunchDeps, 'isPackaged'>): boolean =>
  !deps.isPackaged;

export const restartApp = (deps: RelaunchDeps = defaultDeps()): boolean => {
  if (!shouldOfferRestart(deps)) return false;
  // `relaunch` before `quit`: Electron reuses argv, so a `--remote-debugging-port`
  // launch keeps its CDP port. In-flight tool calls die with the process; that
  // is the same contract as quitting by hand.
  deps.relaunch();
  deps.quit();
  return true;
};
