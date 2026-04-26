import { createLogger } from '../../logger';

const composeLogger = createLogger({ module: 'prepare_step_compose' });

// Accept any prepareStep-like function. The AI SDK's prepareStep signature uses
// PromiseLike and generic ToolSets, making it impossible to type precisely here
// without coupling to the SDK.  We use the broadest callable type and handle
// the final type assertion at the call site in chat_conversation_runner.
// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type, @typescript-eslint/no-explicit-any
type AnyPrepareStep = (...args: any[]) => any;

export const composePrepareSteps = (
  ...prepareSteps: (AnyPrepareStep | undefined)[]
): AnyPrepareStep => {
  const activeSteps = prepareSteps.filter((ps): ps is AnyPrepareStep => Boolean(ps));
  if (activeSteps.length === 0) return () => undefined;
  if (activeSteps.length === 1) return activeSteps[0];

  return async (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...args: any[]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ): Promise<any> => {
    const options = args[0];
    const allMessages: unknown[] = [];
    for (const ps of activeSteps) {
      try {
        const result = await ps(options);
        const messages =
          result && typeof result === 'object' && 'messages' in result
            ? (result as { messages?: unknown[] }).messages
            : undefined;
        if (Array.isArray(messages) && messages.length > 0) {
          allMessages.push(...messages);
        }
      } catch (error) {
        composeLogger.error('prepareStep composition error', error);
      }
    }
    return allMessages.length > 0 ? { messages: allMessages } : undefined;
  };
};
