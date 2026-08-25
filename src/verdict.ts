import type { Deployment, Job, Run } from "./state.ts";

/**
 * `cancelled` is missing on purpose: a schedule cancels its own predecessor under a concurrency
 * group, and that is the scheduler working rather than the workflow failing.
 */
const alarming = new Set(["failure", "startup_failure", "timed_out", "action_required"]);

export function broke(conclusion: string | null | undefined): boolean {
  return conclusion != null && alarming.has(conclusion);
}

const sunk = new Set(["failure", "error"]);

export function wrong(run: Pick<Run, "jobs" | "deployments" | "settled">): boolean {
  if (run.jobs.some(({ conclusion }: Job) => broke(conclusion))) return true;
  if (run.deployments.some(({ state }: Deployment) => sunk.has(state))) return true;

  return broke(run.settled);
}
