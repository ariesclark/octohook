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
  /** What the annotations endpoint is asked for; only a check run ever names one. */
  checkRunId?: number;
  annotations?: Annotation[];
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
  /** Its finished jobs have been asked once more for annotations GitHub had not yet filed. */
  swept?: boolean;
  /** Latched, never cleared: a re-run going green must not delete the message that woke someone. */
  alarmed?: true;
};

/** What the rendering knew and the folded payload no longer carries. */
export type Facts = {
  sender?: { login?: string; type?: string };
  ref?: string;
  merged?: boolean;
  draft?: boolean;
  /** The pull request the note is about, which is where its runs are approved. */
  pull?: string;
};

export type Note = {
  key: string;
  at: string;
  seen: string;
  kind: string;
  action?: string;
  repository?: Repository;
  sha?: string;
  facts?: Facts;
  /** The review this note is, or the review a line comment was left as part of. */
  review?: string;
  content: unknown;
};

export function ownerOf(
  notes: Note[],
  run: Pick<Run, "sha" | "run" | "cause" | "branch">,
): Note | undefined {
  const trigger = run.run?.trigger ?? run.cause;
  if (!run.sha) return undefined;

  // A check an app posts through the Checks API names no trigger, and GitHub leaves its
  // `pull_requests` empty for a fork, so the commit it ran on is all there is to place it by.
  const candidates = notes.filter(
    (note) => note.sha === run.sha && (!trigger || note.kind === trigger),
  );

  // Several pushes can carry one commit — a branch, the branch it merged into, a tag cut from it —
  // so a run belongs to whichever of them named the ref it ran on, rather than to the last to
  // arrive. A run whose ref names none of them keeps the latest, which is all there is to go on.
  const named = candidates.filter((note) => note.facts?.ref && note.facts.ref === run.branch);
  const placed = named.length > 0 ? named : candidates;

  // Every pull request action repeats the head commit, but only the ones that brought it ran
  // anything, so a merge or a label must not take the board from the update it belongs to.
  const brought = placed.filter((note) => !note.action || carrying.has(note.action));
  const kept = brought.length > 0 ? brought : placed;

  return kept[kept.length - 1];
}

const carrying = new Set(["opened", "synchronize", "reopened", "ready_for_review"]);

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

/**
 * Checks whose suite named no run of its own gather under `suite-<id>`, which owns nothing and can
 * belong to no note. The workflow run says which suite it ran, so it takes them back.
 */
function adopt(world: World, entry: Run, suiteId: number | undefined): void {
  if (suiteId === undefined) return;

  const key = `suite-${suiteId}`;
  if (key === entry.id) return;

  const stray = world.runs.get(key);
  if (!stray) return;

  for (const job of stray.jobs) upsertJob(entry, job);

  const shipped = new Set(entry.deployments.map(({ id }) => id));
  for (const deployment of stray.deployments)
    if (!shipped.has(deployment.id)) entry.deployments.push(deployment);

  entry.alarmed ??= stray.alarmed;
  entry.startedAt ??= stray.startedAt;

  world.runs.delete(key);
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
/**
 * Finished jobs holding no annotations, which is not proof there are none: the runner files them
 * against a check run it has already completed, so an ask at completion can arrive too early.
 */
export function unswept(entry: Run): Job[] {
  if (entry.swept) return [];

  return entry.jobs.filter(
    (job) => job.conclusion && job.checkRunId !== undefined && (job.annotations?.length ?? 0) === 0,
  );
}

/** Being held for approval is a wait, not a verdict: the run has not finished saying anything. */
export function awaiting(settled: string | null | undefined): boolean {
  return settled === undefined || settled === "action_required";
}

export function watching(world: World): Run[] {
  return [...world.runs.values()].filter(
    (entry) =>
      entry.repository?.full_name &&
      // A run GitHub never settled is owed a verdict, and a run holding no job at all will never
      // be brought one by its own checks — both have to be asked for.
      (awaiting(entry.settled) ||
        (entry.jobs.length > 0 &&
          (entry.jobs.some(({ conclusion }) => !conclusion) || unswept(entry).length > 0))),
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
      id: number;
      name: string;
      html_url: string;
      head_sha: string;
      conclusion: string | null;
      started_at: string | null;
      completed_at: string | null;
      check_suite?: { head_branch?: string };
      app?: { name?: string };
      pull_requests?: Array<{ number?: number }>;
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
      checkRunId: check.id,
      annotations: resolved.annotations,
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
      check_suite_id?: number;
      conclusion: string | null;
      head_sha?: string;
      head_branch?: string;
      run_started_at?: string;
      updated_at?: string;
    };

    const entry = run(world, resolved.runId, at, seen);
    adopt(world, entry, workflow.check_suite_id);

    // GitHub renames a run under way — a `dynamic` one is created under a placeholder and titled
    // once its agent has something to say — so the latest event names it, not the first.
    entry.run = {
      name: workflow.name || entry.run?.name || resolved.run?.name || "",
      runNumber: workflow.run_number,
      trigger: workflow.event,
    };
    entry.repository ??= repositoryIn(payload);
    entry.sha ??= workflow.head_sha;
    entry.branch ??= workflow.head_branch;
    // Approval starts a run over, and GitHub moves `run_started_at` with it, so the wait before
    // it is not counted as time the run took.
    entry.startedAt = workflow.run_started_at ?? entry.startedAt;
    // `updated_at` moves while the run is going, so it only reads as an end once there is a verdict.
    entry.completedAt = workflow.conclusion ? workflow.updated_at : undefined;
    // Approval sets a run going again, so the wait it was under is over.
    if (entry.settled === "action_required") entry.settled = undefined;

    // Only a finish settles a run: being asked for or getting under way carries no verdict, and
    // saying so would read as a run that ended without one.
    if (action !== "completed") return `run is ${action}`;

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
      action: action ?? undefined,
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
