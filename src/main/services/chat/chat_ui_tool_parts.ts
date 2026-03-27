export { normalizeToolPartForValidation } from '../../../shared/chat/tool_parts';

import { createPrefixedId } from '../../../shared/utils/id';

export const createRuntimeId = (prefix: string) => createPrefixedId(prefix);
