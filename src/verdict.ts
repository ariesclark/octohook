import { fold } from "./discord/events/check-run/annotations.ts";
import { meetsAnnotationLevel } from "./discord/events/check-run/run.ts";
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

/** The annotations a reader would see, folded the way the board folds a repeated one. */
export function warningsUnder(run: Pick<Run, "jobs">): number {
  return run.jobs.reduce(
    (count, job) => count + fold((job.annotations ?? []).filter(meetsAnnotationLevel)).length,
    0,
  );
}

/** Everything the board draws beneath the run: annotations, a job's own summary, deployments. */
export function detailsUnder(run: Pick<Run, "jobs" | "deployments">): number {
  const summaries = run.jobs.filter(({ output }) => output?.title || output?.summary).length;

  return warningsUnder(run) + summaries + run.deployments.length;
}
