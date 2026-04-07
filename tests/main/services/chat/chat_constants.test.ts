import { describe, expect, it } from 'vitest';

import { TOOL_AGENT_SYSTEM_PROMPT } from '../../../../src/main/services/chat/chat_constants';

describe('TOOL_AGENT_SYSTEM_PROMPT', () => {
  it('teaches the main agent when delegated agent use is appropriate', () => {
    expect(TOOL_AGENT_SYSTEM_PROMPT).toContain(
      'Use the dedicated `agent` tool only when the turn contains a bounded side investigation, review, or synthesis task'
    );
    expect(TOOL_AGENT_SYSTEM_PROMPT).toContain(
      'Good `agent` examples: compare docs/pages and return differences'
    );
    expect(TOOL_AGENT_SYSTEM_PROMPT).toContain(
      'Do not use `agent` for trivial work, one or two direct tool calls'
    );
    expect(TOOL_AGENT_SYSTEM_PROMPT).toContain(
      'If the likely next step is `shell`, `read_file`, `write_file`, `edit`, or `delete_file`, keep that work under the main agent'
    );
    expect(TOOL_AGENT_SYSTEM_PROMPT).toContain(
      'Do not delegate the entire user request; delegate only a bounded intermediate result with a clear output contract'
    );
  });
});
