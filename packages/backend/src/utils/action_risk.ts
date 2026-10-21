export type ActionRisk = 'safe' | 'escalate';

/**
 * The final approval answer for ONE tool call.
 *
 * `ask` = a human must decide before the effect happens. `allow` = the call may
 * run unattended. The resolver publishes it as the tool's `needsApproval`
 * predicate; nothing else may compute it.
 */
export type ToolApprovalDecision = 'allow' | 'ask';

/**
 * The session/turn dial (ADR 005).
 *
 * Declared here rather than in `agent/harness` so lower layers
 * (`turn_prep/tool_guard`) can CALL the decision without importing upward —
 * the dependency points one way only (`.dependency-cruiser.cjs`
 * `tools-below-session` / `turn-prep-below-session`).
 */
export type ApprovalPolicy = 'never' | 'trustWorkspace' | 'askRisky' | 'always';

/**
 * Tools whose only effect is to READ. A conservative name list, not a proof:
 * anything absent is "not known safe" (ADR 005 decision 2 — the classifier
 * does not parse shell command text and does not guess unknown tools safe).
 */
export const READ_TOOLS = new Set([
  'read_file',
  'web_search',
  'fetch',
  'load_skill',
  'list_personal_skills',
  'read_personal_skill',
  'list_todo_lists',
  'read_todo_list',
  'list_awaiters',
  'read_awaiter',
  'list_proactive_tasks',
  'read_proactive_task',
]);

/**
 * Tools whose effect is confined to the selected workspace by
 * `tools/workspace_paths.ts` (each opens the `validated` realpath, never the
 * caller's spelling). This list answers ONE question only — "which writes may
 * run under `trustWorkspace` when the tool itself never asked" — and it is not
 * a power to authorise a tool that DID ask. See `decideToolApproval`.
 */
export const WORKSPACE_WRITE_TOOLS = new Set(['write_file', 'edit', 'undo_edit']);

/**
 * A tool's OWN declaration. Structural on purpose: the resolver passes a full
 * `AgentTool`, `turn_prep/tool_guard` passes registry metadata, and neither
 * should satisfy the other's nominal type just to ask one question.
 */
export type ToolApprovalDeclaration = {
  name: string;
  /** Static declaration. A function means "this call decides". */
  needsApproval?: boolean | ((input: unknown, options?: unknown) => boolean | Promise<boolean>);
  /**
   * ADR 005 / MCP `approval_mode`. 'always' is the tool author's strongest
   * statement — show every call to a human. It is a FLOOR: no dial, no global
   * switch and no name list may lower it.
   */
  approvalMode?: 'configurable' | 'always';
};

export type ToolApprovalInput = {
  /** The turn's dial. `undefined` = pre-ADR-005 legacy behavior. */
  policy?: ApprovalPolicy;
  /** The call's arguments. Absent = the caller wants the static answer only. */
  input?: unknown;
  /** ADR 005's pre-existing global switch; consulted only without a policy. */
  autoApprove?: boolean;
  /** Legacy affect-derived flag; consulted only without a policy. */
  requireApproval?: boolean;
  /** Pre-computed per-call answer for a FUNCTION-valued declaration. */
  declaredDecision?: boolean;
};

/** How the tool's own declaration answers, before any policy touches it. */
const declaration = (tool: ToolApprovalDeclaration): ToolApprovalDecision => {
  if (tool.needsApproval === true) return 'ask';
  // A function computes its own answer per call. It is NOT approval-free: the
  // weak `!== true` reading classified such a tool as free and cleared it,
  // silently discarding the tool's own answer (see
  // tests/backend/agent/harness/tool_resolver_declared_approval.test.ts).
  if (typeof tool.needsApproval === 'function') return 'ask';
  return 'allow';
};

/**
 * Decide whether ONE tool call needs a human before it may run.
 *
 * THE SINGLE AUTHORITY. The same question used to be answered three times —
 * `tool_resolver.resolveStaticTool`'s branch chain,
 * `utils/tool_approval.applyToolApprovalPolicy` (which rewrote
 * `needsApproval: true` into `false`), and the per-step `policyBox` closure in
 * `prepareToolWithGuard` — and the three disagreed: `approvalMode: 'always'`
 * was honoured by some paths and ignored by others, and a session dial could
 * silently LOWER a tool's own declaration. That is the implicit privilege
 * channel #166 forbids: identical user configuration produced different
 * authorization depending on which path resolved the tool.
 *
 * Precedence, each step explaining why it outranks the next:
 *
 * 1. `approvalMode === 'always'` → ask. The tool author's floor; outranks the
 *    dial because the dial states the user's TOLERANCE while the declaration
 *    states the tool's EFFECT — tolerance cannot make an effect smaller. The
 *    one exception is `never` (step 2), the documented ADR 005 headless mode.
 * 2. An explicit dial:
 *      `never` → allow. ADR 005 decision 1: "all tools resolved through
 *        ordinary approval need no approval" (eval/daemon automation must have
 *        a legal unattended setting instead of rewriting tool flags). This is
 *        the ONLY branch that discards a floor, it is deliberate, and it is
 *        pinned by a test so removing it is an ADR edit rather than a silent
 *        side effect.
 *      `always` → ask.
 *      `askRisky` → ask unless the tool is a known READ.
 *      `trustWorkspace` → ask unless the tool is a known read OR a known
 *        workspace write. This is a NAME-level answer, so it may only apply to
 *        tools that never asked (step 3): a declaring tool keeps its floor and
 *        #166's implicit channel (`WRITE_TOOLS` marking `write_file` safe
 *        without ever looking at the path) stays closed.
 * 3. The tool's own declaration — a FLOOR (README "Approval policy"):
 *      `needsApproval: true` → ask, whatever the dial said in step 2.
 *      `needsApproval: false`/absent → allow.
 *      A FUNCTION → `declaredDecision` when the caller evaluated it, else ask
 *        (a call-specific answer cannot be guessed safely).
 * 4. No dial (legacy): `requireApproval`, else the global `autoApprove`, else
 *    step 3. Both legacy flags are superseded by an explicit dial (ADR 005:
 *    "the new enum takes precedence over the global switch"), which is why
 *    they cannot appear in steps 1–3.
 *
 * REMOVED — ADR 005 decision 3's learned exact-argument allowlist. It used to
 * sit between steps 1 and 2 ("a stored rule matching the call's complete JSON
 * arguments → allow"). Its only writers, `addToolAllowlistEntry` /
 * `removeToolAllowlistEntry` in `db/tool_allowlist.ts`, never had a production
 * caller, so the rule set was permanently empty: the branch could never return
 * 'allow' and only cost a database read per tool per step. It is deleted rather
 * than left dormant because an always-empty rule set that still participates in
 * the decision reads as a configured allowlist. `ToolApprovalInput` no longer
 * has an `allowPatterns` field, and migration `007_drop_dead_tables` drops the
 * table.
 *
 * PURE: no I/O, no registry read, no clock. The caller owns the durable state
 * (the tool metadata) and passes it in, so the same inputs always produce the
 * same answer — which is what makes "one rule, one implementation" checkable
 * instead of asserted.
 */
export const decideToolApproval = (
  tool: ToolApprovalDeclaration,
  input: ToolApprovalInput = {}
): ToolApprovalDecision => {
  const declared = declaration(tool);

  // 1. The author's floor (ADR 005: `never` is the documented exception).
  if (tool.approvalMode === 'always' && input.policy !== 'never') return 'ask';

  if (input.policy) {
    // 2a. The only legal "discard the floor" dial.
    if (input.policy === 'never') return 'allow';

    if (input.policy === 'always') return 'ask';
    const trustWorkspace = input.policy === 'trustWorkspace';
    const classified =
      READ_TOOLS.has(tool.name) || (trustWorkspace && WORKSPACE_WRITE_TOOLS.has(tool.name));
    // 2b. The explicit dial is the user's own decision, so it outranks a tool's
    // DEFAULT. `needsApproval: true` on `write_file`/`edit`/`undo_edit` is what
    // applies when no dial is given (step 3/4) — it is not a floor. ADR 005
    // decision 1 says `trustWorkspace` "让已知工作区读写放行" and decision 2 says
    // it "还放行工作区写工具"; the composer's own copy promises "only ask for
    // actions classified as risky". Requiring approval for every write here made
    // that copy a lie.
    //
    // The floor that CANNOT be lowered is `approvalMode: 'always'` (step 1) —
    // the tool author's statement about the EFFECT, which a dial about the
    // user's TOLERANCE cannot shrink. README's #166 clause is scoped to the
    // no-policy branch for exactly this reason: it forbids affect state from
    // selecting an approval regime, not the user from choosing one.
    return classified ? 'allow' : 'ask';
  }

  // 3/4. No dial: the tool's declaration first, then the pre-ADR-005 flags.
  //
  // This is the LEGACY path, and it must keep the legacy meanings or every
  // caller that never adopted the dial changes behaviour:
  //  - `requireApproval` is the affect-guard's "ask for everything" flag.
  //  - `autoApprove` is the user's global switch. It may only CLEAR an
  //    approval the turn would otherwise ask for; it is not an "everything asks
  //    unless switched on" default. Reading `!autoApprove` as "ask" inverted a
  //    default that the old resolver had: with no policy, `requireApproval:
  //    false` and a tool that never asked meant ALLOW, regardless of the
  //    global switch (the switch was applied afterwards, as a further
  //    relaxation). A caller with the switch off started prompting for every
  //    read-only tool.
  if (declared === 'ask') {
    return input.autoApprove ? 'allow' : 'ask';
  }
  return input.requireApproval ? 'ask' : 'allow';
};

/** The boolean the harness consumes: `ask` pauses the call. */
export const approvalDecisionToBoolean = (decision: ToolApprovalDecision): boolean =>
  decision === 'ask';
