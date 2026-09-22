// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';

import LobeIcon from '../../../packages/desktop/src/renderer/components/Icon/LobeIcon.vue';
import { getIconSvg } from '../../../packages/desktop/src/renderer/components/Icon/icon_svg_assets';
import { getProviderIconName } from '../../../packages/desktop/src/renderer/modules/providers/provider_icons';
import { BUILTIN_PROVIDERS } from '@iki/backend/constants/ProvidersSettings';

// Every name the provider UI can ask for: each built-in provider's mark, plus the
// `grid-2x2` glyph custom providers resolve to.
const REQUIRED_NAMES = [
  ...BUILTIN_PROVIDERS.map(provider => getProviderIconName(provider.id)),
  'grid-2x2',
];

describe('provider icon marks', () => {
  it('ships an inline mark for every icon name the provider UI can produce', () => {
    for (const name of REQUIRED_NAMES) {
      const mark = getIconSvg(name);
      expect(mark, `missing mark for "${name}"`).toBeTruthy();
      expect(mark).toContain('<svg');
      expect(mark).toContain('</svg>');
    }
  });

  it('renders the mark inline so it can inherit currentColor', () => {
    const wrapper = mount(LobeIcon, { props: { name: 'openai', alt: 'OpenAI', size: 16 } });

    const host = wrapper.find('[role="img"]');
    expect(host.exists()).toBe(true);
    expect(host.attributes('aria-label')).toBe('OpenAI');
    expect(wrapper.find('svg').exists()).toBe(true);
  });

  it('falls back to initials for an unknown name instead of fetching', () => {
    const wrapper = mount(LobeIcon, {
      props: { name: 'not-a-real-icon', fallbackText: 'PR' },
    });

    expect(wrapper.find('svg').exists()).toBe(false);
    expect(wrapper.text()).toBe('PR');
  });
});
