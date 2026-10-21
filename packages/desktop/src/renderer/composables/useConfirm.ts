import { readonly, ref } from 'vue';

export interface ConfirmOptions {
  
  message: string;
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  
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

export const confirmAction = (options: ConfirmOptions): Promise<boolean> => {
  settle(false);
  dialogOptions.value = options;
  visible.value = true;
  return new Promise(resolve => {
    pendingResolve = resolve;
  });
};

export const useConfirmDialog = () => ({
  visible: readonly(visible),
  options: readonly(dialogOptions),
  accept: () => settle(true),
  dismiss: () => settle(false),
});
