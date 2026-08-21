import { tOf } from "../../messages.ts";

/**
 * Deployments read as a sentence about what happened, the way pushes and pull requests do —
 * "deployed main to canary" rather than "main canary deployment succeeded".
 */
export function deploymentVerb(state: string): string {
  return tOf("deploy", state, state);
}

/** A torn-down environment is about the environment; the ref it once held says nothing. */
export function namesRef(state: string): boolean {
  return state !== "inactive";
}
