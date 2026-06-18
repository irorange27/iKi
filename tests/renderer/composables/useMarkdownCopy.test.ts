// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useMarkdownCopy } from '../../../packages/desktop/src/renderer/composables/useMarkdownCopy';

describe('useMarkdownCopy', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('copies the clicked code block through the clipboard API and clears the copied flag later', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    document.body.innerHTML = `
      <div class="md-code-block">
        <button class="md-code-copy-btn">Copy</button>
        <pre><code>const answer = 42;</code></pre>
      </div>
    `;

    const button = document.querySelector('.md-code-copy-btn');
    if (!(button instanceof HTMLButtonElement)) {
      throw new Error('Expected copy button');
    }

    const { handleMarkdownClick } = useMarkdownCopy();

    await handleMarkdownClick({ target: button } as MouseEvent);

    expect(writeText).toHaveBeenCalledWith('const answer = 42;');
    expect(button.dataset.copied).toBe('true');

    await vi.advanceTimersByTimeAsync(1200);

    expect(button.dataset.copied).toBeUndefined();
  });

  it('falls back to execCommand copy when navigator.clipboard fails', async () => {
    const writeText = vi.fn(async () => {
      throw new Error('Clipboard unavailable');
    });
    const execCommand = vi.fn(() => true);
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: execCommand,
    });

    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    document.body.innerHTML = `
      <div class="md-code-block">
        <button class="md-code-copy-btn">Copy</button>
        <pre><code>fallback-copy</code></pre>
      </div>
    `;

    const button = document.querySelector('.md-code-copy-btn');
    if (!(button instanceof HTMLButtonElement)) {
      throw new Error('Expected copy button');
    }

    const { handleMarkdownClick } = useMarkdownCopy();

    await handleMarkdownClick({ target: button } as MouseEvent);

    expect(writeText).toHaveBeenCalledWith('fallback-copy');
    expect(execCommand).toHaveBeenCalledWith('copy');
    expect(button.dataset.copied).toBe('true');
    expect(document.querySelector('textarea')).toBeNull();
  });

  it('ignores clicks that are not on a copy button or have no copyable code text', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    document.body.innerHTML = `
      <div class="md-code-block">
        <button class="not-copy-btn">Copy</button>
        <pre><code>const answer = 42;</code></pre>
      </div>
      <div class="md-code-block">
        <button class="md-code-copy-btn">Copy</button>
        <pre><code>   </code></pre>
      </div>
    `;

    const nonCopyButton = document.querySelector('.not-copy-btn');
    const emptyCopyButton = document.querySelector('.md-code-copy-btn');

    const { handleMarkdownClick } = useMarkdownCopy();

    await handleMarkdownClick({ target: nonCopyButton } as MouseEvent);
    await handleMarkdownClick({ target: emptyCopyButton } as MouseEvent);

    expect(writeText).not.toHaveBeenCalled();
  });
});
