import { GithubEvent } from "../../../github";

export type PullRequestEvent = Extract<GithubEvent, { type: `pull_request.${string}` }>;

export function pullRequestAction(event: PullRequestEvent): string {
  const { action, pull_request } = event;
  const changes = (event as { changes?: { title?: unknown; base?: unknown } }).changes;

  if (action === "closed") return pull_request.merged ? "merged" : "closed";
  if (action === "ready_for_review") return "marked ready for review";
  if (action === "converted_to_draft") return "converted to draft";
  if (action === "synchronize") return "updated";

  // GitHub calls every body tweak an edit.
  if (action === "edited") return changes?.base ? "retargeted" : "renamed";

  return action;
}

export function pullRequestStats(pull_request: {
  commits?: number;
  additions?: number;
  deletions?: number;
  changed_files?: number;
}): string | undefined {
  const parts: string[] = [];

  if (pull_request.commits)
    parts.push(`${pull_request.commits} commit${pull_request.commits === 1 ? "" : "s"}`);
  if (pull_request.additions !== undefined && pull_request.deletions !== undefined)
    parts.push(`+${pull_request.additions} −${pull_request.deletions}`);
  if (pull_request.changed_files)
    parts.push(`${pull_request.changed_files} file${pull_request.changed_files === 1 ? "" : "s"}`);

  return parts.length > 0 ? parts.join(" • ") : undefined;
}
