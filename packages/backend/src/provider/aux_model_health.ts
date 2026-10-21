/**
 * Short-lived failure memory for the auxiliary ("tool") model.
 *
 * The tool model carries every auxiliary call in the harness — tool routing,
 * skill routing, titles, emotion, summaries, memory retrieval. It is resolved
 * from ONE provider (the explicitly configured one, else the first enabled
 * provider), so a single expired credential or exhausted balance silently
 * degraded all of them at once: the router fell back to the full catalog, the
 * emotion and title calls logged a warning and returned nothing, and the only
 * trace was a stack trace per call.
 *
 * This module adds the missing piece: remember that a candidate just failed and
 * prefer the next one for a cooldown window. It is deliberately IN MEMORY and
 * time-bounded:
 *
 * - Persisting it would mean a schema change for runtime-only state, and a
 *   stale "unhealthy" row surviving a fixed credential is worse than none.
 * - The window is short because the failure modes are usually transient (rate
 *   limits, balance top-ups, restarts). After it expires the original choice is
 *   retried, so a recovered provider is used again automatically.
 *
 * The memory does not change WHICH candidates are legal — that stays with the
 * resolver. It only reorders them, so with no recorded failures the behaviour
 * is byte-identical to the previous first-match rule.
 */

type FailureRecord = { failedAt: number };

/** How long a failed candidate is skipped before it is tried again. */
export const AUX_MODEL_COOLDOWN_MS = 5 * 60 * 1000;

const failures = new Map<string, FailureRecord>();

/** Key a candidate by what a failure actually belongs to (the credential + model). */
export const auxCandidateKey = (providerId: string | undefined, model: string): string =>
  `${providerId ?? ''}::${model}`;

export const recordAuxModelFailure = (providerId: string | undefined, model: string): void => {
  failures.set(auxCandidateKey(providerId, model), { failedAt: Date.now() });
};

export const recordAuxModelSuccess = (providerId: string | undefined, model: string): void => {
  failures.delete(auxCandidateKey(providerId, model));
};

export const isAuxModelCoolingDown = (
  providerId: string | undefined,
  model: string,
  now: number = Date.now()
): boolean => {
  const record = failures.get(auxCandidateKey(providerId, model));
  if (!record) return false;
  if (now - record.failedAt >= AUX_MODEL_COOLDOWN_MS) {
    // Expired: forget it so a recovered provider is used again.
    failures.delete(auxCandidateKey(providerId, model));
    return false;
  }
  return true;
};

/**
 * Reorder candidates so cooling-down ones go last, preserving relative order.
 *
 * Never filters: if every candidate is cooling down, the full list is returned
 * in its original order. "All candidates recently failed" must still make one
 * attempt — refusing to call anything would turn a transient outage into a
 * lasting one.
 */
export const preferHealthyAuxCandidates = <T extends { providerId?: string; model: string }>(
  candidates: T[],
  now: number = Date.now()
): T[] => {
  const healthy: T[] = [];
  const cooling: T[] = [];
  for (const candidate of candidates) {
    (isAuxModelCoolingDown(candidate.providerId, candidate.model, now) ? cooling : healthy).push(
      candidate
    );
  }
  return healthy.length > 0 ? [...healthy, ...cooling] : candidates;
};

/** Test seam: drop all recorded failures. */
export const resetAuxModelHealth = (): void => {
  failures.clear();
};
