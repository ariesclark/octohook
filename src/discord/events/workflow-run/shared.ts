import { GithubEvent } from "../../../github";
import { checkMark } from "../../marks";
import { tOf } from "../../messages.ts";

export { checkMark as runConclusionMark };

export type WorkflowRunEvent = Extract<GithubEvent, { type: `workflow_run.${string}` }>;

const conclusionLabels: Partial<Record<string, string>> = {
  success: "passed",
  failure: "failed",
  cancelled: "was cancelled",
  timed_out: "timed out",
  action_required: "needs action",
  neutral: "finished",
  skipped: "was skipped",
  stale: "went stale",
  startup_failure: "failed to start",
};

/** A workflow reports itself as a path when it was never given a name of its own. */
export function workflowName(name: string): string {
  return name.replace(/^.*\//, "").replace(/\.ya?ml$/, "");
}

export function runConclusionLabel(conclusion: string | null): string {
  if (!conclusion) return "is running";
  return conclusionLabels[conclusion] ?? conclusion;
}

export function triggerLabel(trigger: string): string {
  return tOf("trigger", trigger, trigger);
}

export function runDuration(started: string | null, updated: string | null): string | undefined {
  if (!started || !updated) return undefined;

  const seconds = Math.round((new Date(updated).getTime() - new Date(started).getTime()) / 1000);
  if (seconds <= 0) return undefined;
  if (seconds < 60) return `${seconds}s`;

  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
}
