import type { Annotation, ResolvedRun } from "./discord/events/check-run/run.ts";

/**
 * What the channel knows, as one value. An event's only job is to fold itself into this; nothing
 * here decides what a message looks like or when one is sent. Rendering reads this from scratch
 * every time, so a late event, a repeated one and an out-of-order one all land the same way.
 */

export type Job = {
  name: string;
  url: string;
  conclusion: string | null;
  startedAt: string | null;
  completedAt: string | null;
  /** What the check said, when it said anything: type errors, lint warnings, deprecations. */
  annotations?: Annotation[];
  /** What the check said about itself: a deployed url, a count of alerts, a warning. */
  output?: { title?: string; summary?: string };
};

export type Deployment = {
  id: number;
  state: string;
  /** The environment until it has a host to point at, and the host from then on. */
  place: string;
  url?: string;
  /** The job that did the deploying, so a deployment can be shown as its doing. */
  jobUrl?: string;
};

/** Enough of a repository to draw a board's links from. One channel can be fed by many. */
export type Repository = { name: string; full_name?: string; html_url: string };

export type Run = {
  id: string;
  at: string;
  /** When this last reported, which is what decides whether it is still news. */
  seen: string;
  repository?: Repository;
  sha?: string;
  branch?: string;
  /** Absent until the API says which workflow this is; a check suite may never have one. */
  run?: ResolvedRun;
  /** What to call it when no workflow run does: the app that posted the checks. */
  title?: string;
  jobs: Job[];
  deployments: Deployment[];
  settled?: string | null;
};

/** A message with nothing left to say: a push, a pull request, a deleted branch. */
export type Note = {
  key: string;
  at: string;
  /** The event that made it, since which note a run belongs under depends on what it is. */
  kind: string;
  repository?: Repository;
  sha?: string;
  content: unknown;
};

/**
 * Which note a run belongs under: the event that set it off. A commit on a pull request branch
 * is reported twice and builds twice, and the two runs are not the same work — one built the
 * branch head, the other the merge commit — so each belongs to the event that asked for it.
 *
 * A run nothing asked for in this channel — a schedule, an issue comment, a dependency bot —
 * belongs to no note. Left to match on the commit alone, those gather under whatever happens to
 * sit at the head of the branch and pile up there all day.
 */
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
  payload: Record<string, unknown>;
};

/** What the caller resolved before folding an event in, since state itself never does I/O. */
export type Resolved = {
  runId?: string;
  run?: ResolvedRun;
  annotations?: Annotation[];
  /** A rendered message for events that say one thing and are done. */
  content?: unknown;
};

function run(world: World, id: string, at: string): Run {
  const existing = world.runs.get(id);
  if (existing) {
    // Order in the channel is fixed when a run first appears; how recently it spoke is what
    // decides whether it is still worth drawing, and only the second of those moves.
    if (at > existing.seen) existing.seen = at;
    return existing;
  }

  const created: Run = { id, at, seen: at, jobs: [], deployments: [] };
  world.runs.set(id, created);

  return created;
}

function repositoryIn(payload: Record<string, unknown>): Repository | undefined {
  const repository = payload.repository as Repository | undefined;
  if (!repository?.name || !repository.html_url) return undefined;

  return { name: repository.name, full_name: repository.full_name, html_url: repository.html_url };
}

/**
 * Everything the channel has stopped hearing about. A replay ends and takes its world with it; a
 * channel does not, so a commit that stopped reporting has to be let go of or the world grows
 * for as long as the worker runs.
 *
 * Returns the composed keys it dropped, because the message ids drawn under them have to be let
 * go of in the same breath — a forgotten message must be left where it is in the channel, and
 * anything still holding its id would read the absence as "no longer true" and take it down.
 */
export function forget(world: World, before: string): string[] {
  const dropped: string[] = [];

  for (const [id, entry] of world.runs) {
    if (entry.seen >= before) continue;

    world.runs.delete(id);
    dropped.push(`run:${id}`);
  }

  const kept = [...world.runs.values()];

  world.notes = world.notes.filter((note) => {
    if (note.at >= before) return true;
    if (kept.some((entry) => ownerOf([note], entry)?.key === note.key)) return true;

    dropped.push(note.key);
    return false;
  });

  return dropped;
}

/**
 * Folds one delivery into the world and says what it changed, in words, so a caller can report
 * it. An empty string means the event was understood and changed nothing — which is a different
 * thing from an event nobody knows what to do with, and the caller can tell them apart.
 */
export function apply(world: World, delivery: Delivery, resolved: Resolved = {}): string {
  const { payload, event, action } = delivery;
  const at = delivery.delivered_at;

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

    const entry = run(world, resolved.runId, at);
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

    // A `created` can arrive after the `completed` it belongs to. A verdict already reached is
    // never withdrawn by a later event that has none.
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

    const entry = run(world, resolved.runId, at);
    entry.run ??= resolved.run;
    entry.repository ??= repositoryIn(payload);
    entry.sha ??= suite.head_sha;
    entry.branch ??= suite.head_branch;
    entry.settled = suite.conclusion;

    return `suite settled → ${suite.conclusion ?? "no verdict"}`;
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

    const entry = run(world, resolved.runId, at);
    entry.run ??= resolved.run;
    entry.repository ??= repositoryIn(payload);
    entry.sha ??= deployment.sha;

    // Only `environment_url` names a host. `target_url` is a deprecated alias of `log_url` and
    // names the job, which is not somewhere the deployment went.
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

  // Everything else says one thing once. The caller renders it; state only remembers it, and the
  // sha ties a push to the runs its commit set off.
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
      kind: event,
      repository: repositoryIn(payload),
      sha,
      content: resolved.content,
    };

    // GitHub redelivers, by hand from the hook page and by itself after a bad response. Kept
    // twice, a note is two messages saying the same thing for as long as the channel holds it.
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
