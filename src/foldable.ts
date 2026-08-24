import type { Delivery } from "./state.ts";

export type Folded = Delivery & {
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

const commits: Record<string, string> = {
  check_run: "check_run.head_sha",
  check_suite: "check_suite.head_sha",
  deployment: "deployment.sha",
  deployment_status: "deployment.sha",
  push: "after",
  workflow_run: "workflow_run.head_sha",
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
  workflow_run: [
    ...repository,
    "workflow_run.id",
    "workflow_run.name",
    "workflow_run.run_number",
    "workflow_run.event",
    "workflow_run.conclusion",
    "workflow_run.head_sha",
    "workflow_run.head_branch",
  ],
  pull_request: [...repository, "pull_request.head.sha"],
};

export function foldablePayload(name: string, payload: Payload): Payload {
  const trimmed: Payload = {};

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
