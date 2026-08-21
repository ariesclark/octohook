import type { Delivery } from "./state.ts";

/**
 * Which events gather into a live message, and what of an event survives the trip to the channel
 * that shows it. Only the fields the fold and the lookups in front of it read are carried: a raw
 * `push` is mostly a list of commits nothing here looks at, and the trimmed payload is also what
 * ends up written to the channel's storage.
 *
 * Anything a reader sees was rendered before the trip and travels as `content`.
 */

export type Folded = Delivery & {
  /** Rendered at the edge for an event that says one thing and is done: a push, a star. */
  content?: unknown;
};

type Payload = Record<string, unknown>;

function at(payload: Payload, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>(
      (value, key) => (value && typeof value === "object" ? (value as Payload)[key] : undefined),
      payload,
    );
}

/**
 * Where each event keeps the commit it is about, and so which events are a commit's news at all.
 * An event that names no commit — a star, an issue, a deleted branch — has nothing to gather
 * with and nothing to be edited into later.
 */
const commits: Record<string, string> = {
  check_run: "check_run.head_sha",
  check_suite: "check_suite.head_sha",
  deployment: "deployment.sha",
  deployment_status: "deployment.sha",
  push: "after",
  pull_request: "pull_request.head.sha",
};

export function isFoldable(name: string): boolean {
  return name in commits;
}

export function shaOf(name: string, payload: Payload): string | undefined {
  const path = commits[name];
  if (!path) return undefined;

  const sha = at(payload, path);
  return typeof sha === "string" && sha.length > 0 ? sha : undefined;
}

/**
 * The fields `apply` folds, `referenceFor` looks up, and a board draws its links from — nothing
 * else. A check run's `output` is the one place with no ceiling, since a tool may put its whole
 * report in `text`, so it is cut to the two fields a job row reads.
 */
const repository = ["repository.name", "repository.full_name", "repository.html_url"];

const carried: Record<string, string[]> = {
  check_run: [
    ...repository,
    "check_run.id",
    "check_run.name",
    "check_run.status",
    "check_run.html_url",
    "check_run.details_url",
    "check_run.head_sha",
    "check_run.conclusion",
    "check_run.started_at",
    "check_run.completed_at",
    "check_run.check_suite.id",
    "check_run.check_suite.head_branch",
    "check_run.app.name",
    "check_run.output.title",
    "check_run.output.summary",
    "check_run.output.annotations_count",
  ],
  check_suite: [
    ...repository,
    "check_suite.id",
    "check_suite.conclusion",
    "check_suite.head_sha",
    "check_suite.head_branch",
  ],
  deployment: [...repository, "deployment.id", "deployment.environment", "deployment.sha"],
  deployment_status: [
    ...repository,
    "workflow_run.html_url",
    "deployment.id",
    "deployment.environment",
    "deployment.sha",
    "deployment_status.state",
    "deployment_status.environment",
    "deployment_status.environment_url",
    "deployment_status.target_url",
    "deployment_status.log_url",
  ],
  push: [...repository, "after"],
  pull_request: [...repository, "pull_request.head.sha"],
};

export function foldablePayload(name: string, payload: Payload): Payload {
  const trimmed: Payload = {};

  // An event that gathers into nothing still says which repository it is about, and a note drawn
  // months from now builds its links from that and nothing else.
  for (const path of carried[name] ?? repository) {
    const value = at(payload, path);
    if (value === undefined) continue;

    const keys = path.split(".");
    const last = keys.pop()!;

    let target = trimmed;
    for (const key of keys) target = (target[key] ??= {}) as Payload;

    target[last] = value;
  }

  return trimmed;
}
