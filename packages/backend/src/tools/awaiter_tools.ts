import { z } from 'zod';

import {
  createAwaiter,
  deleteAwaiter,
  listAwaiterRecords,
  readAwaiterRecord,
  updateAwaiter,
  type AwaiterUpdateInput,
} from '../awaiters/awaiter_manager';
import { BaseTool } from '@iki/core/tools/base';
import { zodSchemaToJsonSchema } from '@iki/core/tools/json_schema';
import { getToolRuntimeContext } from '@iki/core/tools/runtime_context';
import {
  DeleteAwaiterInputSchema,
  DeleteAwaiterOutputSchema,
  ListAwaitersInputSchema,
  ListAwaitersOutputSchema,
  ReadAwaiterInputSchema,
  ReadAwaiterOutputSchema,
  WriteAwaiterInputSchema,
  WriteAwaiterOutputSchema,
} from '@iki/core/tools/schemas';

const toStoredTrigger = (trigger: z.infer<typeof WriteAwaiterInputSchema>['trigger']) => {
  if (!trigger) return undefined;
  if (trigger.kind === 'time_at') {
    return {
      kind: 'time_at' as const,
      at: trigger.at,
    };
  }

  return {
    kind: 'time_after' as const,
    delay_minutes: trigger.delayMinutes,
  };
};

const resolveAwaiterThreadId = (explicitThreadId?: string): string => {
  const runtimeThreadId = getToolRuntimeContext().threadId?.trim() || '';
  const provided = explicitThreadId?.trim() || '';
  const resolved = provided || runtimeThreadId;

  if (!resolved) {
    throw new Error('threadId is required when there is no current chat thread');
  }

  return resolved;
};

const resolveConversationModelDefaults = (args: z.infer<typeof WriteAwaiterInputSchema>) => {
  const runtimeModel = getToolRuntimeContext().conversationModel;
  const explicitProviderType = args.providerType?.trim() || '';
  const providerType = explicitProviderType || runtimeModel?.providerType?.trim() || '';
  const providerTypeMatchesRuntime =
    !explicitProviderType ||
    (runtimeModel?.providerType?.trim() || '') === explicitProviderType;

  const model =
    args.model?.trim() ||
    (providerTypeMatchesRuntime ? runtimeModel?.model?.trim() || '' : '');
  const providerId =
    args.providerId?.trim() ||
    (providerTypeMatchesRuntime ? runtimeModel?.providerId?.trim() || '' : '');

  if (!providerType) {
    throw new Error('providerType is required when no current chat model is available');
  }
  if (!model) {
    throw new Error('model is required when it cannot be inferred from the current chat');
  }

  return {
    provider_type: providerType,
    provider_id: providerId || null,
    model,
  };
};

const resolveAwaiterModelUpdates = (
  args: z.infer<typeof WriteAwaiterInputSchema>,
  existing: {
    provider_type?: string;
    provider_id?: string | null;
    model?: string;
  }
) => {
  const hasProviderType = Object.prototype.hasOwnProperty.call(args, 'providerType');
  const hasProviderId = Object.prototype.hasOwnProperty.call(args, 'providerId');
  const hasModel = Object.prototype.hasOwnProperty.call(args, 'model');

  if (!hasProviderType && !hasProviderId && !hasModel) {
    return null;
  }

  const providerType = hasProviderType
    ? args.providerType?.trim() || ''
    : existing.provider_type?.trim() || '';
  const model = hasModel ? args.model?.trim() || '' : existing.model?.trim() || '';

  if (!providerType) {
    throw new Error('providerType is required when updating awaiter model settings');
  }
  if (!model) {
    throw new Error('model is required when updating awaiter model settings');
  }

  return {
    provider_type: providerType,
    provider_id: hasProviderId ? args.providerId?.trim() || null : existing.provider_id ?? null,
    model,
  };
};

const buildResumeContext = () => {
  const runtimeContext = getToolRuntimeContext();
  if (!runtimeContext.runId && !runtimeContext.threadId) return null;

  return JSON.stringify({
    createdFromRunId: runtimeContext.runId ?? null,
    createdFromThreadId: runtimeContext.threadId ?? null,
  });
};

export class ListAwaitersTool extends BaseTool {
  override name = 'list_awaiters';
  override displayName = 'List Awaiters';
  override type = 'function';
  override autoAllowed = true;
  override needsApproval = false;
  override description =
    'List persistent continue-later awaiters so you can inspect, update, or delete an existing deferred continuation.';
  override paramSchema = ListAwaitersInputSchema;
  override outputSchema = zodSchemaToJsonSchema(ListAwaitersOutputSchema, {
    title: 'list_awaiters_output',
  });

  protected override async handler(args: z.infer<typeof this.paramSchema>) {
    const awaiters = listAwaiterRecords({
      query: args.query,
      limit: args.limit,
    });

    return {
      awaiters,
      resultCount: awaiters.length,
    };
  }
}

export class ReadAwaiterTool extends BaseTool {
  override name = 'read_awaiter';
  override displayName = 'Read Awaiter';
  override type = 'function';
  override autoAllowed = true;
  override needsApproval = false;
  override description = 'Read an awaiter by id or exact title.';
  override paramSchema = ReadAwaiterInputSchema;
  override outputSchema = zodSchemaToJsonSchema(ReadAwaiterOutputSchema, {
    title: 'read_awaiter_output',
  });

  protected override async handler(args: z.infer<typeof this.paramSchema>) {
    return {
      awaiter: readAwaiterRecord({
        id: args.id,
        title: args.title,
      }),
    };
  }
}

export class WriteAwaiterTool extends BaseTool {
  override name = 'write_awaiter';
  override displayName = 'Write Awaiter';
  override type = 'function';
  override autoAllowed = true;
  override needsApproval = true;
  override approvalMode = 'always' as const;
  override description =
    'Create or update a persistent continue-later awaiter. New awaiters default to the current chat thread and current chat model unless you override them.';
  override paramSchema = WriteAwaiterInputSchema;
  override outputSchema = zodSchemaToJsonSchema(WriteAwaiterOutputSchema, {
    title: 'write_awaiter_output',
  });

  protected override async handler(args: z.infer<typeof this.paramSchema>) {
    const trigger = toStoredTrigger(args.trigger);

    if (args.action === 'create') {
      if (!trigger) {
        throw new Error('trigger is required when action=create');
      }

      const modelDefaults = resolveConversationModelDefaults(args);
      const awaiter = createAwaiter({
        title: args.title?.trim() || '',
        instruction: args.instruction?.trim() || '',
        thread_id: resolveAwaiterThreadId(args.threadId),
        notify: args.notify,
        origin_run_id: getToolRuntimeContext().runId ?? null,
        resume_context_json: buildResumeContext(),
        trigger,
        ...modelDefaults,
      });

      return {
        action: 'created' as const,
        awaiter: readAwaiterRecord({ id: awaiter.id }),
      };
    }

    const awaiterReference = {
      id: args.id,
      title: args.currentTitle,
    };
    const existingAwaiter = readAwaiterRecord(awaiterReference);
    if (!existingAwaiter) {
      throw new Error('Awaiter not found');
    }

    const updatePayload: AwaiterUpdateInput = {};
    if (typeof args.title === 'string') updatePayload.title = args.title.trim();
    if (typeof args.instruction === 'string') updatePayload.instruction = args.instruction.trim();
    if (typeof args.notify === 'boolean') updatePayload.notify = args.notify;
    if (typeof args.threadId === 'string' && args.threadId.trim()) {
      updatePayload.thread_id = resolveAwaiterThreadId(args.threadId);
    }
    if (trigger) updatePayload.trigger = trigger;
    const modelUpdates = resolveAwaiterModelUpdates(args, existingAwaiter);
    if (modelUpdates) {
      Object.assign(updatePayload, modelUpdates);
    }

    const awaiter = updateAwaiter(awaiterReference, updatePayload);

    return {
      action: 'updated' as const,
      awaiter: readAwaiterRecord({ id: awaiter.id }),
    };
  }
}

export class DeleteAwaiterTool extends BaseTool {
  override name = 'delete_awaiter';
  override displayName = 'Delete Awaiter';
  override type = 'function';
  override autoAllowed = true;
  override needsApproval = true;
  override approvalMode = 'always' as const;
  override description = 'Delete an awaiter by id or exact title.';
  override paramSchema = DeleteAwaiterInputSchema;
  override outputSchema = zodSchemaToJsonSchema(DeleteAwaiterOutputSchema, {
    title: 'delete_awaiter_output',
  });

  protected override async handler(args: z.infer<typeof this.paramSchema>) {
    return deleteAwaiter({
      id: args.id,
      title: args.title,
    });
  }
}
