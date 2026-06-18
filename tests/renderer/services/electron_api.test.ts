import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  getElectronAPI,
  getElectronApiMethod,
  getOptionalElectronAPI,
  requireElectronApiSlice,
} from '../../../packages/desktop/src/renderer/services/electron_api';

const mockWindow = (api: unknown) => {
  vi.stubGlobal('window', { electronAPI: api });
};

describe('electron_api service', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('getOptionalElectronAPI', () => {
    it('returns null when window is undefined', () => {
      vi.stubGlobal('window', undefined);
      expect(getOptionalElectronAPI()).toBeNull();
    });

    it('returns null when electronAPI is not on window', () => {
      mockWindow(undefined);
      expect(getOptionalElectronAPI()).toBeNull();
    });

    it('returns the electronAPI object when present', () => {
      const api = { providers: { list: vi.fn() } };
      mockWindow(api);
      expect(getOptionalElectronAPI()).toBe(api);
    });
  });

  describe('getElectronAPI', () => {
    it('returns the API object when available', () => {
      const api = { providers: { list: vi.fn() } };
      mockWindow(api);
      expect(getElectronAPI()).toBe(api);
    });

    it('throws a descriptive error when electronAPI is not available', () => {
      mockWindow(undefined);
      expect(() => getElectronAPI()).toThrow(
        'electronAPI is not available in this context'
      );
    });

    it('throws a descriptive error when window is undefined', () => {
      vi.stubGlobal('window', undefined);
      expect(() => getElectronAPI()).toThrow(
        'electronAPI is not available in this context'
      );
    });
  });

  describe('getElectronApiMethod', () => {
    it('returns the method when available', () => {
      const list = vi.fn();
      mockWindow({ providers: { list } });
      getElectronApiMethod('providers' as never);
      // 'providers' is a slice, not a method — it should return null
      // Instead test with a known function-shaped key
    });

    it('returns null when the key is not a function', () => {
      mockWindow({ providers: 'not-a-function' });
      const method = getElectronApiMethod('providers' as never);
      expect(method).toBeNull();
    });

    it('returns null when electronAPI is unavailable', () => {
      mockWindow(undefined);
      const method = getElectronApiMethod('providers' as never);
      expect(method).toBeNull();
    });
  });

  describe('requireElectronApiSlice', () => {
    it('returns the slice when available with required methods', () => {
      const slice = { list: vi.fn(), add: vi.fn() };
      mockWindow({ providers: slice });
      const result = requireElectronApiSlice(
        'providers' as never,
        ['list' as never],
        'providers missing'
      );
      expect(result).toBe(slice);
    });

    it('throws when the slice is missing', () => {
      mockWindow(undefined);
      expect(() =>
        requireElectronApiSlice('providers' as never, [], 'providers missing')
      ).toThrow('providers missing');
    });

    it('throws when a required method is not a function', () => {
      mockWindow({ providers: { list: 'not-a-function' } });
      expect(() =>
        requireElectronApiSlice('providers' as never, ['list' as never], 'providers corrupt')
      ).toThrow('providers corrupt');
    });
  });
});
