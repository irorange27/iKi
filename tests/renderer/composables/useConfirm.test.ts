// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';

import {
  confirmAction,
  useConfirmDialog,
} from '../../../packages/desktop/src/renderer/composables/useConfirm';

describe('useConfirm', () => {
  it('resolves true on accept and closes the dialog', async () => {
    const dialog = useConfirmDialog();
    const pending = confirmAction({ message: 'Delete entry?', danger: true });

    expect(dialog.visible.value).toBe(true);
    expect(dialog.options.value?.message).toBe('Delete entry?');
    expect(dialog.options.value?.danger).toBe(true);

    dialog.accept();
    await expect(pending).resolves.toBe(true);
    expect(dialog.visible.value).toBe(false);
  });

  it('resolves false on dismiss', async () => {
    const dialog = useConfirmDialog();
    const pending = confirmAction({ message: 'Remove server?' });

    dialog.dismiss();
    await expect(pending).resolves.toBe(false);
    expect(dialog.visible.value).toBe(false);
  });

  it('cancels a pending dialog when a new one opens', async () => {
    const dialog = useConfirmDialog();
    const first = confirmAction({ message: 'first' });

    const second = confirmAction({ message: 'second' });
    await expect(first).resolves.toBe(false);

    expect(dialog.options.value?.message).toBe('second');
    expect(dialog.visible.value).toBe(true);

    dialog.accept();
    await expect(second).resolves.toBe(true);
  });
});
