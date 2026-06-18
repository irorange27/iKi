// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

import SkillSelector from '../../../packages/desktop/src/renderer/components/SkillSelector.vue';

const setElectronApi = (api: unknown) => {
  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    value: api,
  });
};

describe('SkillSelector', () => {
  beforeEach(() => {
    setElectronApi({
      skills: {
        list: vi.fn(async () => [
          {
            id: 'skill_docs',
            name: 'Docs',
            description: 'Use documentation context',
            source: 'user',
            path: '/tmp/Docs/SKILL.md',
          },
        ]),
      },
    });
  });

  afterEach(() => {
    Reflect.deleteProperty(window, 'electronAPI');
  });

  it('exposes trigger tooltip state for empty, auto, and selected modes', async () => {
    const emptyWrapper = mount(SkillSelector, {
      props: {
        skillIds: [],
        mode: 'manual',
      },
    });

    await flushPromises();
    expect(emptyWrapper.find('.composer-selector-trigger').attributes('title')).toBe('Choose skills');

    const autoWrapper = mount(SkillSelector, {
      props: {
        skillIds: [],
        mode: 'auto',
      },
    });

    await flushPromises();
    expect(autoWrapper.find('.composer-selector-trigger').attributes('title')).toBe('Skills: auto');

    const selectedWrapper = mount(SkillSelector, {
      props: {
        skillIds: ['skill_docs'],
        mode: 'manual',
      },
    });

    await flushPromises();
    expect(selectedWrapper.find('.composer-selector-trigger').attributes('title')).toBe(
      'Skills: 1 selected'
    );
  });
});
