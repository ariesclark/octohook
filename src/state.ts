import type { Annotation, ReportedJob, ResolvedRun } from "./discord/events/check-run/run.ts";
import { underway } from "./discord/events/check-run/facts.ts";
import { wrong } from "./verdict.ts";

export type Job = {
  name: string;
  url: string;
  conclusion: string | null;
  startedAt: string | null;
  completedAt: string | null;
  step?: string;
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
  /**
   * What a check says caused it, for the checks GitHub Actions did not run: an app posts them
   * through the Checks API, so there is no workflow run to ask what set them off.
   */
  cause?: string;
  title?: string;
  startedAt?: string;
  completedAt?: string;
  jobs: Job[];
  deployments: Deployment[];
  settled?: string | null;
  /** What GitHub last answered the jobs endpoint with, so a poll that moves nothing costs nothing. */
  etag?: string;
  /** Latched, never cleared: a re-run going green must not delete the message that woke someone. */
  alarmed?: true;
};

/** What the rendering knew and the folded payload no longer carries. */
export type Facts = {
  sender?: { login?: string; type?: string };
  ref?: string;
  merged?: boolean;
  draft?: boolean;
};

export type Note = {
  key: string;
  at: string;
  seen: string;
  kind: string;
  repository?: Repository;
  sha?: string;
  facts?: Facts;
  /** The review this note is, or the review a line comment was left as part of. */
  review?: string;
  content: unknown;
};

export function ownerOf(notes: Note[], run: Pick<Run, "sha" | "run" | "cause">): Note | undefined {
  const trigger = run.run?.trigger ?? run.cause;
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
  facts?: Facts;
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

/** One job, however it was reported: a verdict already reached is never withdrawn by a later say. */
function upsertJob(entry: Run, job: Job): "added" | "updated" | "" {
  const index = entry.jobs.findIndex(({ name }) => name === job.name);

  if (index === -1) {
    entry.jobs.push(job);
    latch(entry);

    return "added";
  }

  // GitHub can deliver a `created` after the `completed` it belongs to.
  if (!job.conclusion && entry.jobs[index]!.conclusion) return "";

  entry.jobs[index] = { ...entry.jobs[index]!, ...job };
  latch(entry);

  return "updated";
}

/** What the jobs endpoint says a run is doing, folded the way its events would be. */
export function applyJobs(
  world: World,
  runId: string,
  jobs: ReportedJob[],
  at: string,
  seen: string,
): string[] {
  const entry = run(world, runId, at, seen);

  return jobs
    .map((reported) => {
      const said = upsertJob(entry, jobOf(reported));
      return said ? `${reported.name} ${said}` : "";
    })
    .filter(Boolean);
}

function jobOf(reported: ReportedJob): Job {
  return {
    name: reported.name,
    url: reported.html_url,
    conclusion: reported.conclusion,
    startedAt: reported.started_at,
    completedAt: reported.completed_at,
    step:
      reported.status === "completed"
        ? undefined
        : reported.steps?.find(({ status }) => status === "in_progress")?.name,
  };
}

function latch(entry: Run): void {
  if (wrong(entry)) entry.alarmed = true;
}

function repositoryIn(payload: Record<string, unknown>): Repository | undefined {
  const repository = payload.repository as Repository | undefined;
  if (!repository?.name || !repository.html_url) return undefined;

  return { name: repository.name, full_name: repository.full_name, html_url: repository.html_url };
}

/** The runs still worth asking GitHub about: a job of theirs has not reached a verdict. */
export function watching(world: World): Run[] {
  return [...world.runs.values()].filter(
    (entry) =>
      entry.repository?.full_name &&
      entry.jobs.length > 0 &&
      entry.jobs.some(({ conclusion }) => !conclusion),
  );
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

/** How a note is named: the event and the moment it happened, so a redelivery lands on it again. */
export function noteKeyOf(delivery: Pick<Delivery, "event" | "action" | "delivered_at">): string {
  return `${delivery.event}.${delivery.action ?? ""}:${delivery.delivered_at}`;
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
      pull_requests?: Array<{ number?: number }>;
      output?: { title?: string | null; summary?: string | null };
    };

    const entry = run(world, resolved.runId, at, seen);
    entry.run ??= resolved.run;
    entry.repository ??= repositoryIn(payload);
    entry.sha ??= check.head_sha;
    entry.branch ??= check.check_suite?.head_branch;
    entry.title ??= check.app?.name;

    // An app's check names the pull request it is for, which is the only cause it ever states.
    if (!resolved.run && check.pull_requests?.length) entry.cause ??= "pull_request";

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

    const said = upsertJob(entry, job);
    return said ? `${said} job ${job.name} → ${job.conclusion ?? "running"}` : "";
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
    latch(entry);

    return `suite settled → ${suite.conclusion ?? "no verdict"}`;
  }

  if (event === "workflow_job") {
    if (!resolved.runId) return "";

    const reported = payload.workflow_job as unknown as ReportedJob;

    const entry = run(world, resolved.runId, at, seen);
    entry.repository ??= repositoryIn(payload);

    const job = jobOf(reported);
    if (!upsertJob(entry, job)) return "";

    if (job.conclusion) return `${job.name} → ${job.conclusion}`;
    return job.step ? `${job.name} is on ${job.step}` : `${job.name} is ${reported.status}`;
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
    // `updated_at` moves while the run is going, so it only reads as an end once there is a verdict.
    entry.completedAt = workflow.conclusion ? workflow.updated_at : undefined;
    entry.settled = workflow.conclusion;
    latch(entry);

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
      latch(entry);

      return `opened deployment ${next.id} → ${next.state} at ${place}`;
    }

    // GitHub delivers in no order, so a start arriving after the finish must not withdraw it.
    if (underway.has(next.state) && !underway.has(entry.deployments[index]!.state)) return "";

    entry.deployments[index] = next;
    latch(entry);

    return `updated deployment ${next.id} → ${next.state} at ${place}`;
  }

  if (resolved.content) {
    const key = noteKeyOf(delivery);

    const sha =
      event === "push"
        ? (payload.after as unknown as string)
        : event === "pull_request"
          ? (payload.pull_request as unknown as { head?: { sha?: string } })?.head?.sha
          : undefined;

    const review = (payload.review as { id?: number } | undefined)?.id;
    const commentOf = (payload.comment as { pull_request_review_id?: number } | undefined)
      ?.pull_request_review_id;

    const note: Note = {
      key,
      at,
      seen,
      kind: event,
      review: (review ?? commentOf)?.toString(),
      repository: repositoryIn(payload),
      sha,
      facts: delivery.facts,
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
