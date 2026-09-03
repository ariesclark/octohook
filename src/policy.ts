import { parse, test as matches } from "liqe";

import { broke, detailsUnder, warningsUnder, wrong } from "./verdict.ts";
import type { Note, Run } from "./state.ts";

/** What a message is, to a query. The fields a hook's `include` and `exclude` may name. */
export type Subject = RunSubject | NoteSubject;

export type Result = "passed" | "failed" | "running" | "skipped" | "cancelled";

export type RunSubject = {
  /** A CI board is one kind of message among the events. */
  type: "run";
  repository?: string;
  branch?: string;
  sha?: string;
  /** What set the run off: `push`, `schedule`, `workflow_dispatch`, `release`. */
  trigger?: string;
  workflow?: string;
  number?: number;
  result: Result;
  /** The worst it has been, so a re-run going green does not erase that it failed. */
  ever: Result;
  seconds?: number;
  /** What the board draws under the run: annotations and deployments. */
  details: number;
  /** How many warnings or worse a reader would see, folded the way the board folds them. */
  annotations: number;
  /** What it shipped, which is a different question from what it said. */
  deployments: number;
  /** Whether it is drawn under the note it ran for, rather than standing on its own. */
  attached: boolean;
  jobs: { total: number; failed: number; passed: number; running: number; skipped: number };
};

export type NoteSubject = {
  /** The GitHub event's own name: `push`, `pull_request`, `issues`, `star`, `delete`. */
  type: string;
  repository?: string;
  branch?: string;
  sha?: string;
  /** Who did it, and whether they are an app. */
  by?: string;
  bot: boolean;
};

const vocabulary = new Set([
  "type",
  "repository",
  "branch",
  "sha",
  "by",
  "bot",
  "trigger",
  "workflow",
  "number",
  "result",
  "ever",
  "seconds",
  "details",
  "annotations",
  "deployments",
  "attached",
  "jobs",
  "jobs.total",
  "jobs.failed",
  "jobs.passed",
  "jobs.running",
  "jobs.skipped",
]);

function every(run: Run, conclusion: string): boolean {
  return run.jobs.length > 0 && run.jobs.every((job) => job.conclusion === conclusion);
}

function resultOf(run: Run): Result {
  if (wrong(run)) return "failed";
  if (run.jobs.some(({ conclusion }) => !conclusion)) return "running";
  if (run.settled === "cancelled" || every(run, "cancelled")) return "cancelled";
  if (every(run, "skipped")) return "skipped";

  return "passed";
}

function secondsOf(run: Run): number | undefined {
  if (!run.startedAt || !run.completedAt) return undefined;

  const seconds = Math.round(
    (new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime()) / 1000,
  );

  return seconds > 0 ? seconds : undefined;
}

export function subjectOfRun(run: Run, attached = false): RunSubject {
  const failed = run.jobs.filter(({ conclusion }) => broke(conclusion)).length;
  const running = run.jobs.filter(({ conclusion }) => !conclusion).length;
  const skipped = run.jobs.filter(({ conclusion }) => conclusion === "skipped").length;

  const result = resultOf(run);
  const ever: Result = run.alarmed === true || wrong(run) ? "failed" : result;
  const annotations = warningsUnder(run);

  return {
    type: "run",
    repository: run.repository?.full_name ?? run.repository?.name,
    sha: run.sha,
    branch: run.branch,
    trigger: run.run?.trigger,
    workflow: run.run?.name,
    number: run.run?.runNumber,
    result,
    ever,
    seconds: secondsOf(run),
    details: detailsUnder(run, annotations),
    annotations,
    deployments: run.deployments.length,
    attached,
    jobs: {
      total: run.jobs.length,
      failed,
      running,
      skipped,
      passed: run.jobs.length - failed - running - skipped,
    },
  };
}

export function subjectOfNote(note: Note): NoteSubject {
  const { sender, ref } = note.facts ?? {};

  return {
    type: note.kind,
    repository: note.repository?.full_name ?? note.repository?.name,
    sha: note.sha,
    branch: ref,
    by: sender?.login,
    bot: sender?.type === "Bot",
  };
}

function fieldsIn(node: unknown, found: string[] = []): string[] {
  if (!node || typeof node !== "object") return found;

  const { field, left, right, operand } = node as {
    field?: { name?: string };
    left?: unknown;
    right?: unknown;
    operand?: unknown;
  };

  if (field?.name && field.name !== "<implicit>") found.push(field.name);

  return [left, right, operand].reduce<string[]>((all, child) => fieldsIn(child, all), found);
}

/** Fields no subject carries, which would silently match nothing rather than mean anything. */
export function strangeFields(query: string): string[] {
  if (!query) return [];

  let parsed;

  try {
    parsed = parse(query);
  } catch {
    return [query];
  }

  const strange = fieldsIn(parsed).filter((name) => !vocabulary.has(name));
  return [...new Set(strange)];
}

export type Query = { include?: string; exclude?: string };

/** A query that names nothing a subject has would silence a channel, so it is refused whole. */
function usable(query: string | undefined): string | undefined {
  if (!query || strangeFields(query).length > 0) return undefined;

  try {
    parse(query);
  } catch {
    return undefined;
  }

  return query;
}

function names(query: string | undefined, subject: Subject): boolean {
  const readable = usable(query);

  return readable ? matches(parse(readable), subject) : false;
}

export function drawn({ include, exclude }: Query, subject: Subject): boolean {
  if (usable(include) && !names(include, subject)) return false;

  return !names(exclude, subject);
}
