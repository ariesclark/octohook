import {
  boardMark,
  CommitBoard,
  RunBoard,
  type Board,
  type CommitBoardEntry,
} from "./discord/events/check-run/board";
import { marks } from "./discord/marks";
import { workflowName } from "./discord/events/workflow-run/shared";
import type { HookScope } from "./discord/refs";
import { isFoldable } from "./foldable.ts";
import { mergeAdjacent } from "./merge.ts";
import { drawn, subjectOfNote, subjectOfRun, type Query, type Subject } from "./policy.ts";
import { ComponentType } from "discord-api-types/v10";

import { ownerOf, type Note, type Repository, type Run, type World } from "./state.ts";

export type Composed = {
  key: string;
  at: string;
  content: unknown;
  merges?: boolean;
};

const mergeWindow = 60_000;

const order = [marks.bad, marks.expired, marks.warning, marks.quiet, marks.good, marks.dropped];

function ranked(run: Run): string {
  const rank = order.indexOf(boardMark(run.jobs, run.deployments, run.settled));

  return String(rank === -1 ? order.length : rank);
}

function named(run: Run): string {
  return run.run ? `0${workflowName(run.run.name)}` : `1${run.title ?? run.id}`;
}

function toBoard(run: Run): Board & { runId: string } {
  return {
    runId: run.id,
    run: run.run,
    settled: run.settled,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    title: run.title,
    sha: run.sha,
    branch: run.branch,
    jobs: run.jobs,
    deployments: run.deployments,
  };
}

export function compose(
  world: World,
  repository: Repository,
  hook?: HookScope,
  queries?: Map<string, Query>,
): Composed[] {
  const composed: Composed[] = [];

  const asked = (where: Repository | undefined, subject: Subject) => {
    const name = where?.full_name ?? where?.name;
    if (!name) return true;

    return drawn(queries?.get(name) ?? {}, subject);
  };

  // A line comment belongs to the review that carried it, and is drawn inside its message.
  const reviews = new Map<string, Note>();
  for (const note of world.notes)
    if (note.kind === "pull_request_review" && note.review) reviews.set(note.review, note);

  const carried = new Map<string, unknown[]>();
  const folded = new Set<string>();

  for (const note of world.notes) {
    if (note.kind !== "pull_request_review_comment" || !note.review) continue;

    const review = reviews.get(note.review);
    if (!review || !asked(review.repository, subjectOfNote(review))) continue;

    const { components = [] } = note.content as {
      components?: { type?: number; components?: unknown[] }[];
    };

    // A container cannot hold another, so a comment's own box is opened and its parts kept.
    const parts = components.flatMap((component) =>
      component.type === ComponentType.Container ? (component.components ?? []) : [component],
    );

    carried.set(review.key, [...(carried.get(review.key) ?? []), ...parts]);
    folded.add(note.key);
  }

  const withComments = (note: Note): unknown => {
    const comments = carried.get(note.key);
    if (!comments) return note.content;

    const content = note.content as { components?: { type?: number; components?: unknown[] }[] };
    const components = [...(content.components ?? [])];

    const index = components.findLastIndex(
      (component) => component.type === ComponentType.Container,
    );
    const container = index === -1 ? undefined : components[index];

    if (!container) return { ...content, components: [...components, ...comments] };

    components[index] = {
      ...container,
      components: [...(container.components ?? []), ...comments],
    };

    return { ...content, components };
  };

  const owner = new Map<string, string>();
  const claimed = new Set<string>();

  for (const run of world.runs.values()) {
    const note = ownerOf(world.notes, run);
    if (!note) continue;

    owner.set(run.id, note.key);
    claimed.add(run.id);
  }

  const standalone: Run[] = [];

  for (const note of world.notes) {
    if (folded.has(note.key)) continue;

    const runs = [...world.runs.values()]
      .filter((run) => owner.get(run.id) === note.key)
      .filter((run) => asked(run.repository, subjectOfRun(run, true)))
      .sort(
        (left, right) =>
          ranked(left).localeCompare(ranked(right)) || named(left).localeCompare(named(right)),
      );

    // A run the query keeps outlives the note it belonged to, rather than going down with it.
    if (!asked(note.repository, subjectOfNote(note))) {
      standalone.push(...runs);
      continue;
    }

    if (runs.length === 0) {
      composed.push({
        key: note.key,
        at: note.at,
        content: withComments(note),
        merges: !isFoldable(note.kind),
      });

      continue;
    }

    const board = CommitBoard({
      entries: runs.map(toBoard) as CommitBoardEntry[],
      repository: note.repository ?? runs[0]?.repository ?? repository,
      pull: note.facts?.pull,
    }) as { components?: unknown[] };

    const content = withComments(note) as { components?: unknown[] };

    composed.push({
      key: note.key,
      at: note.at,
      content: {
        ...content,
        components: [...(content.components ?? []), ...(board.components ?? [])],
      },
    });
  }

  for (const run of world.runs.values()) {
    if (claimed.has(run.id)) {
      if (!standalone.includes(run)) continue;
    } else if (!asked(run.repository, subjectOfRun(run, false))) continue;

    composed.push({
      key: `run:${run.id}`,
      at: run.at,
      content: RunBoard({ board: toBoard(run), repository: run.repository ?? repository, hook }),
    });
  }

  return mergeAdjacent(
    composed.sort(
      (left, right) => left.at.localeCompare(right.at) || left.key.localeCompare(right.key),
    ),
    mergeWindow,
  );
}
