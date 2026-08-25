import type { Deployment, Job } from "../../../state.ts";

/** A deployment still on its way says nothing yet, so nothing draws it. */
export const underway = new Set(["in_progress", "queued", "pending"]);

export function arrived<T extends Pick<Deployment, "state">>(deployments: T[]): T[] {
  return deployments.filter(({ state }) => !underway.has(state));
}

/** Whether a job posted a line of its own, which the board draws under it. */
export function said(job: Pick<Job, "output">): boolean {
  return Boolean(job.output?.title || job.output?.summary);
}
