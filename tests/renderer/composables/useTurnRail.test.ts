// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, nextTick, ref } from 'vue';
import { mount } from '@vue/test-utils';
import { useTurnRail } from '../../../packages/desktop/src/renderer/composables/useTurnRail';

afterEach(() => vi.unstubAllGlobals());

describe('turn rail scheduling', () => {
  it('coalesces resize bursts, keeps marker references stable and cancels work on unmount', async () => {
    let resize!: () => void;
    const callbacks = new Map<number, FrameRequestCallback>();
    let nextId = 0;
    const cancel = vi.fn((id: number) => callbacks.delete(id));
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callbacks.set(++nextId, callback);
      return nextId;
    });
    vi.stubGlobal('cancelAnimationFrame', cancel);
    const disconnect = vi.fn();
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: () => void) {
          resize = callback;
        }
        observe = vi.fn();
        disconnect = disconnect;
      }
    );
    const element = document.createElement('div');
    element.innerHTML =
      '<div class="messages-container">' +
      Array.from(
        { length: 5 },
        (_, i) => `<div class="message-wrapper user" data-message-id="${i}"></div>`
      ).join('') +
      '</div>';
    const scrollHeight = vi.fn(() => 1000);
    Object.defineProperty(element, 'scrollHeight', { get: scrollHeight });
    Object.defineProperty(element, 'clientHeight', { value: 200 });
    let rail!: ReturnType<typeof useTurnRail>;
    const visible = ref(true);
    const wrapper = mount(
      defineComponent({
        setup() {
          rail = useTurnRail(ref([]), ref(element), ref('thread'), visible);
          return () => h('div');
        },
      })
    );
    const frame = () => {
      const queued = [...callbacks.values()];
      callbacks.clear();
      queued.forEach(callback => callback(0));
    };
    frame();
    const markers = rail.turnMarkers.value;
    expect(markers).toEqual(['0', '1', '2', '3', '4']);
    scrollHeight.mockClear();
    for (let i = 0; i < 100; i++) resize();
    expect(callbacks.size).toBe(1);
    frame();
    expect(scrollHeight).toHaveBeenCalledTimes(1);
    expect(rail.turnMarkers.value).toBe(markers);
    visible.value = false;
    await nextTick();
    await nextTick();
    frame();
    expect(scrollHeight).toHaveBeenCalledTimes(1);
    resize();
    wrapper.unmount();
    expect(callbacks.size).toBe(0);
    expect(disconnect).toHaveBeenCalled();
    resize();
    expect(callbacks.size).toBe(0);
  });
});
