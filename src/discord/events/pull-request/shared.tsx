import { GithubEvent } from "../../../github";

export type PullRequestEvent = Extract<GithubEvent, { type: `pull_request.${string}` }>;

export type PullRequestChanges = {
  title?: { from?: string };
  base?: { ref?: { from?: string } };
};

export function pullRequestChanges(event: PullRequestEvent): PullRequestChanges | undefined {
  return (event as { changes?: PullRequestChanges }).changes;
}

export function pullRequestAction(event: PullRequestEvent): string {
  const { action, pull_request } = event;
  const changes = pullRequestChanges(event);

  if (action === "closed") return pull_request.merged ? "merged" : "closed";
  if (action === "ready_for_review") return "marked ready for review";
  if (action === "converted_to_draft") return "converted to draft";
  if (action === "synchronize") return "updated";

  // GitHub calls every body tweak an edit; only a retarget reaches a message.
  if (action === "edited") return changes?.base ? "retargeted" : "edited";

  return action;
}
