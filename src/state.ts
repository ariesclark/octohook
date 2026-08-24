import type { Annotation, ResolvedRun } from "./discord/events/check-run/run.ts";

export type Job = {
  name: string;
  url: string;
  conclusion: string | null;
  startedAt: string | null;
  completedAt: string | null;
  annotations?: Annotation[];
  output?: { title?: string; summary?: string };
};

export type Deployment = {
  id: number;
  state: string;
  place: string;
  url?: string;
  jobUrl?: string;
};

export type Repository = { name: string; full_name?: string; html_url: string };

export type Run = {
  id: string;
  at: string;
  seen: string;
  repository?: Repository;
  sha?: string;
  branch?: string;
  run?: ResolvedRun;
  title?: string;
  startedAt?: string;
  completedAt?: string;
  jobs: Job[];
  deployments: Deployment[];
  settled?: string | null;
};

export type Note = {
  key: string;
  at: string;
  seen: string;
  kind: string;
  repository?: Repository;
  sha?: string;
  content: unknown;
};

export function ownerOf(notes: Note[], run: Pick<Run, "sha" | "run">): Note | undefined {
  const trigger = run.run?.trigger;
  if (!run.sha || !trigger) return undefined;

  const candidates = notes.filter((note) => note.sha === run.sha && note.kind === trigger);
  return candidates[candidates.length - 1];
}

export type World = {
  runs: Map<string, Run>;
  notes: Note[];
};

export function emptyWorld(): World {
  return { runs: new Map(), notes: [] };
}

export type Delivery = {
  event: string;
  action: string | null;
  delivered_at: string;
  received_at?: string;
  payload: Record<string, unknown>;
};

export type Resolved = {
  runId?: string;
  run?: ResolvedRun;
  annotations?: Annotation[];
  content?: unknown;
};

function run(world: World, id: string, at: string, seen: string): Run {
  const existing = world.runs.get(id);
  if (existing) {
    if (seen > existing.seen) existing.seen = seen;
    return existing;
  }

  const created: Run = { id, at, seen, jobs: [], deployments: [] };
  world.runs.set(id, created);

  return created;
}

function repositoryIn(payload: Record<string, unknown>): Repository | undefined {
  const repository = payload.repository as Repository | undefined;
  if (!repository?.name || !repository.html_url) return undefined;

  return { name: repository.name, full_name: repository.full_name, html_url: repository.html_url };
}

export function forget(world: World, before: string): string[] {
  const dropped: string[] = [];

  for (const [id, entry] of world.runs) {
    if (entry.seen >= before) continue;

    world.runs.delete(id);
    dropped.push(`run:${id}`);
  }

  const kept = [...world.runs.values()];

  world.notes = world.notes.filter((note) => {
    if (note.seen >= before) return true;
    if (kept.some((entry) => ownerOf([note], entry)?.key === note.key)) return true;

    dropped.push(note.key);
    return false;
  });

  return dropped;
}

export function apply(world: World, delivery: Delivery, resolved: Resolved = {}): string {
  const { payload, event, action } = delivery;
  const at = delivery.delivered_at;
  const seen = delivery.received_at ?? at;

  if (event === "check_run") {
    if (!resolved.runId) return "";

    const check = payload.check_run as unknown as {
      name: string;
      html_url: string;
      head_sha: string;
      conclusion: string | null;
      started_at: string | null;
      completed_at: string | null;
      check_suite?: { head_branch?: string };
      app?: { name?: string };
      output?: { title?: string | null; summary?: string | null };
    };

    const entry = run(world, resolved.runId, at, seen);
    entry.run ??= resolved.run;
    entry.repository ??= repositoryIn(payload);
    entry.sha ??= check.head_sha;
    entry.branch ??= check.check_suite?.head_branch;
    entry.title ??= check.app?.name;

    const job: Job = {
      name: check.name,
      url: check.html_url,
      conclusion: check.conclusion,
      startedAt: check.started_at,
      completedAt: check.completed_at,
      annotations: resolved.annotations,
      output:
        check.output?.title || check.output?.summary
          ? { title: check.output.title ?? undefined, summary: check.output.summary ?? undefined }
          : undefined,
    };

    const index = entry.jobs.findIndex(({ name }) => name === job.name);
    if (index === -1) {
      entry.jobs.push(job);
      return `added job ${job.name} → ${job.conclusion ?? "running"}`;
    }

    // GitHub can deliver a `created` after the `completed` it belongs to.
    if (!job.conclusion && entry.jobs[index]!.conclusion) return "";

    entry.jobs[index] = { ...job, annotations: job.annotations ?? entry.jobs[index]!.annotations };
    return `updated job ${job.name} → ${job.conclusion ?? "running"}`;
  }

  if (event === "check_suite") {
    if (!resolved.runId) return "";

    const suite = payload.check_suite as unknown as {
      conclusion: string | null;
      head_sha?: string;
      head_branch?: string;
    };

    const entry = run(world, resolved.runId, at, seen);
    entry.run ??= resolved.run;
    entry.repository ??= repositoryIn(payload);
    entry.sha ??= suite.head_sha;
    entry.branch ??= suite.head_branch;
    entry.settled = suite.conclusion;

    return `suite settled → ${suite.conclusion ?? "no verdict"}`;
  }

  if (event === "workflow_run") {
    if (!resolved.runId) return "";

    const workflow = payload.workflow_run as unknown as {
      name: string;
      run_number: number;
      event: string;
      conclusion: string | null;
      head_sha?: string;
      head_branch?: string;
      run_started_at?: string;
      updated_at?: string;
    };

    const entry = run(world, resolved.runId, at, seen);
    entry.run ??= resolved.run ?? {
      name: workflow.name,
      runNumber: workflow.run_number,
      trigger: workflow.event,
    };
    entry.repository ??= repositoryIn(payload);
    entry.sha ??= workflow.head_sha;
    entry.branch ??= workflow.head_branch;
    entry.startedAt ??= workflow.run_started_at;
    entry.completedAt = workflow.updated_at;
    entry.settled = workflow.conclusion;

    return `run settled → ${workflow.conclusion ?? "no verdict"}`;
  }

  if (event === "deployment" || event === "deployment_status") {
    if (!resolved.runId) return "";

    const deployment = payload.deployment as unknown as {
      id: number;
      environment: string;
      sha?: string;
    };

    const status = payload.deployment_status as unknown as
      | {
          state: string;
          environment: string;
          environment_url?: string;
          target_url?: string;
          log_url?: string;
        }
      | undefined;

    const entry = run(world, resolved.runId, at, seen);
    entry.run ??= resolved.run;
    entry.repository ??= repositoryIn(payload);
    entry.sha ??= deployment.sha;

    // `target_url` is a deprecated alias of `log_url`, and names the job rather than a host.
    const url = status?.environment_url || undefined;
    const place = status?.environment_url
      ? new URL(status.environment_url).host
      : (status?.environment ?? deployment.environment);

    const next: Deployment = {
      id: deployment.id,
      state: status?.state ?? "pending",
      place,
      url,
      jobUrl: status?.log_url ?? status?.target_url,
    };

    const index = entry.deployments.findIndex(({ id }) => id === next.id);
    if (index === -1) {
      entry.deployments.push(next);
      return `opened deployment ${next.id} → ${next.state} at ${place}`;
    }

    entry.deployments[index] = next;
    return `updated deployment ${next.id} → ${next.state} at ${place}`;
  }

  if (resolved.content) {
    const key = `${event}.${action ?? ""}:${at}`;

    const sha =
      event === "push"
        ? (payload.after as unknown as string)
        : event === "pull_request"
          ? (payload.pull_request as unknown as { head?: { sha?: string } })?.head?.sha
          : undefined;

    const note: Note = {
      key,
      at,
      seen,
      kind: event,
      repository: repositoryIn(payload),
      sha,
      content: resolved.content,
    };

    // GitHub redelivers, by hand from the hook page and by itself after a bad response.
    const index = world.notes.findIndex((existing) => existing.key === key);
    if (index !== -1) {
      world.notes[index] = note;
      return "";
    }

    world.notes.push(note);
    return `noted ${event}${action ? `.${action}` : ""}`;
  }

  return "";
}
