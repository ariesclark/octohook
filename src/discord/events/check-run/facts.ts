import type { Deployment } from "../../../state.ts";

/** A deployment still on its way says nothing yet, so nothing draws it. */
export const underway = new Set(["in_progress", "queued", "pending"]);

export function arrived<T extends Pick<Deployment, "state">>(deployments: T[]): T[] {
  return deployments.filter(({ state }) => !underway.has(state));
}
