import { ref } from 'vue';

import { getApprovalId } from '@iki/llm/message/tool_parts';

export const createToolApprovalController = (_deps?: unknown) => {
  void _deps;
  const processing = ref<Record<string, boolean>>({});

  const isProcessing = (part: unknown): boolean => {
    const approvalId = getApprovalId(part);
    return approvalId ? !!processing.value[approvalId] : false;
  };

  const handleToolApproval = async (...args: unknown[]): Promise<void> => {
    void args;
    return Promise.resolve();
  };

  return { isApprovalProcessing: isProcessing, handleToolApproval };
};
