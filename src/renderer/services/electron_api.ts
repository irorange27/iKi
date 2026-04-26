import type { ElectronApi } from '../../shared/types/electron_api';

type AnyFunction = (...args: never[]) => unknown;
type SliceKeys = {
  [K in keyof ElectronApi]-?: ElectronApi[K] extends object ? K : never;
}[keyof ElectronApi];

type MethodKeys<T> = {
  [K in keyof T]-?: T[K] extends AnyFunction ? K : never;
}[keyof T];

export const getOptionalElectronAPI = (): ElectronApi | null => {
  if (typeof window === 'undefined') return null;
  return window.electronAPI ?? null;
};

export const getElectronAPI = (): ElectronApi => {
  const api = getOptionalElectronAPI();
  if (!api) {
    throw new Error('electronAPI is not available in this context');
  }
  return api;
};

export const getElectronApiMethod = <K extends MethodKeys<ElectronApi>>(
  key: K
): ElectronApi[K] | null => {
  const method = getOptionalElectronAPI()?.[key];
  return typeof method === 'function' ? (method as ElectronApi[K]) : null;
};

export const getElectronApiSlice = <K extends keyof ElectronApi>(
  key: K,
  requiredMethods: ReadonlyArray<MethodKeys<ElectronApi[K]>> = []
): ElectronApi[K] | null => {
  const slice = getOptionalElectronAPI()?.[key] ?? null;
  if (!slice) return null;

  for (const methodName of requiredMethods) {
    if (typeof slice[methodName] !== 'function') {
      return null;
    }
  }

  return slice;
};

export const getElectronApiSliceMethod = <
  K extends SliceKeys,
  M extends MethodKeys<ElectronApi[K]>,
>(
  sliceKey: K,
  methodKey: M
): ElectronApi[K][M] | null => {
  const slice = getElectronApiSlice(sliceKey, [methodKey]);
  if (!slice) return null;

  const method = slice[methodKey];
  return typeof method === 'function' ? (method as ElectronApi[K][M]) : null;
};

export const requireElectronApiSlice = <K extends keyof ElectronApi>(
  key: K,
  requiredMethods: ReadonlyArray<MethodKeys<ElectronApi[K]>>,
  errorMessage: string
): ElectronApi[K] => {
  const slice = getElectronApiSlice(key, requiredMethods);
  if (!slice) {
    throw new Error(errorMessage);
  }
  return slice;
};

export const requireElectronApiSliceMethod = <
  K extends SliceKeys,
  M extends MethodKeys<ElectronApi[K]>,
>(
  sliceKey: K,
  methodKey: M,
  errorMessage: string
): ElectronApi[K][M] => {
  const method = getElectronApiSliceMethod(sliceKey, methodKey);
  if (!method) {
    throw new Error(errorMessage);
  }
  return method;
};
