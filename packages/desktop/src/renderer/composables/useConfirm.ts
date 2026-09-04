import { readonly, ref } from 'vue';

export interface ConfirmOptions {
  /** Main message body; rendered pre-line so multi-line strings keep their shape. */
  message: string;
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Renders the confirm button in the destructive style. */
  danger?: boolean;
}

const visible = ref(false);
const dialogOptions = ref<ConfirmOptions | null>(null);
let pendingResolve: ((confirmed: boolean) => void) | null = null;

const settle = (confirmed: boolean) => {
  const resolve = pendingResolve;
  pendingResolve = null;
  visible.value = false;
  dialogOptions.value = null;
  resolve?.(confirmed);
};

/**
 * Promise-based in-app confirmation, replacing window.confirm which renders an
 * unstylable native dialog inside Electron. Opening a new dialog while one is
 * pending resolves the previous one as cancelled.
 */
export const confirmAction = (options: ConfirmOptions): Promise<boolean> => {
  settle(false);
  dialogOptions.value = options;
  visible.value = true;
  return new Promise(resolve => {
    pendingResolve = resolve;
  });
};

/** Binds the singleton dialog state for the single <ConfirmDialog /> host. */
export const useConfirmDialog = () => ({
  visible: readonly(visible),
  options: readonly(dialogOptions),
  accept: () => settle(true),
  dismiss: () => settle(false),
});
