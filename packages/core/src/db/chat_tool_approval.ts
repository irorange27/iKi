import { getDb } from './database';
import type {
  ChatToolApproval,
  ChatToolApprovalDecision,
  ChatToolApprovalSession,
  ChatToolApprovalState,
} from '../types/chat_tool_approval';

type UpsertChatToolApprovalSessionInput = Omit<
  ChatToolApprovalSession,
  'created_at' | 'updated_at'
>;

type UpsertChatToolApprovalInput = Omit<
  ChatToolApproval,
  'created_at' | 'updated_at' | 'responded_at' | 'decision' | 'decision_reason'
>;

const ACTIVE_APPROVAL_STATES: ChatToolApprovalState[] = ['pending', 'answered'];

export const getChatToolApprovalSession = (sessionId: string): ChatToolApprovalSession | null => {
  const row = getDb()
    .prepare('SELECT * FROM chat_tool_approval_sessions WHERE session_id = ?')
    .get(sessionId) as ChatToolApprovalSession | undefined;
  return row ?? null;
};

export const getChatToolApproval = (approvalId: string): ChatToolApproval | null => {
  const row = getDb()
    .prepare('SELECT * FROM chat_tool_approvals WHERE approval_id = ?')
    .get(approvalId) as ChatToolApproval | undefined;
  return row ?? null;
};

export const getChatToolApprovalsBySession = (
  sessionId: string,
  states?: ChatToolApprovalState[]
): ChatToolApproval[] => {
  const normalizedStates = Array.isArray(states)
    ? states.filter(
        (state): state is ChatToolApprovalState =>
          state === 'pending' || state === 'answered' || state === 'consumed'
      )
    : [];

  const baseSql = 'SELECT * FROM chat_tool_approvals WHERE session_id = ?';
  const stateClause =
    normalizedStates.length > 0
      ? ` AND state IN (${normalizedStates.map(() => '?').join(', ')})`
      : '';
  const sql = `${baseSql}${stateClause} ORDER BY created_at ASC, approval_id ASC`;
  const params = [sessionId, ...normalizedStates];

  return getDb()
    .prepare(sql)
    .all(...params) as ChatToolApproval[];
};

export const getActiveChatToolApprovalsBySession = (sessionId: string): ChatToolApproval[] =>
  getChatToolApprovalsBySession(sessionId, ACTIVE_APPROVAL_STATES);

export const upsertChatToolApprovalSession = (session: UpsertChatToolApprovalSessionInput) => {
  const now = new Date().toISOString();
  return getDb()
    .prepare(
      `
        INSERT INTO chat_tool_approval_sessions (
          session_id, thread_id, assistant_message_id, run_id, provider_type, provider_id, model,
          system_prompt, max_input_tokens, max_output_tokens, max_iterations, enabled_tools,
          available_skill_ids, created_at, updated_at
        ) VALUES (
          @session_id, @thread_id, @assistant_message_id, @run_id, @provider_type, @provider_id, @model,
          @system_prompt, @max_input_tokens, @max_output_tokens, @max_iterations, @enabled_tools,
          @available_skill_ids, @created_at, @updated_at
        )
        ON CONFLICT(session_id) DO UPDATE SET
          thread_id = excluded.thread_id,
          assistant_message_id = excluded.assistant_message_id,
          run_id = excluded.run_id,
          provider_type = excluded.provider_type,
          provider_id = excluded.provider_id,
          model = excluded.model,
          system_prompt = excluded.system_prompt,
          max_input_tokens = excluded.max_input_tokens,
          max_output_tokens = excluded.max_output_tokens,
          max_iterations = excluded.max_iterations,
          enabled_tools = excluded.enabled_tools,
          available_skill_ids = excluded.available_skill_ids,
          updated_at = excluded.updated_at
      `
    )
    .run({
      ...session,
      created_at: now,
      updated_at: now,
    });
};

export const upsertChatToolApprovals = (approvals: UpsertChatToolApprovalInput[]) => {
  if (approvals.length === 0) return;

  const db = getDb();
  const now = new Date().toISOString();
  const stmt = db.prepare(
    `
      INSERT INTO chat_tool_approvals (
        approval_id, session_id, tool_call_id, tool_name, tool_args, state, decision,
        decision_reason, responded_at, created_at, updated_at
      ) VALUES (
        @approval_id, @session_id, @tool_call_id, @tool_name, @tool_args, @state, NULL,
        NULL, NULL, @created_at, @updated_at
      )
      ON CONFLICT(approval_id) DO UPDATE SET
        session_id = excluded.session_id,
        tool_call_id = excluded.tool_call_id,
        tool_name = excluded.tool_name,
        tool_args = excluded.tool_args,
        updated_at = excluded.updated_at,
        state = CASE
          WHEN chat_tool_approvals.state = 'pending' THEN excluded.state
          ELSE chat_tool_approvals.state
        END
    `
  );

  const run = db.transaction((rows: UpsertChatToolApprovalInput[]) => {
    for (const row of rows) {
      stmt.run({
        ...row,
        created_at: now,
        updated_at: now,
      });
    }
  });

  run(approvals);
};

export const answerChatToolApproval = (
  approvalId: string,
  decision: ChatToolApprovalDecision,
  reason: string
) => {
  const now = new Date().toISOString();
  return getDb()
    .prepare(
      `
        UPDATE chat_tool_approvals
        SET state = 'answered',
            decision = @decision,
            decision_reason = @decision_reason,
            responded_at = @responded_at,
            updated_at = @updated_at
        WHERE approval_id = @approval_id
      `
    )
    .run({
      approval_id: approvalId,
      decision,
      decision_reason: reason,
      responded_at: now,
      updated_at: now,
    });
};

export const consumeChatToolApprovalSession = (sessionId: string) => {
  const now = new Date().toISOString();
  return getDb()
    .prepare(
      `
        UPDATE chat_tool_approvals
        SET state = 'consumed',
            updated_at = @updated_at
        WHERE session_id = @session_id AND state != 'consumed'
      `
    )
    .run({
      session_id: sessionId,
      updated_at: now,
    });
};
