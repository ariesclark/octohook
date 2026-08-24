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
import { ownerOf, type Repository, type Run, type World } from "./state.ts";

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

export function compose(world: World, repository: Repository, hook?: HookScope): Composed[] {
  const composed: Composed[] = [];

  const owner = new Map<string, string>();
  const claimed = new Set<string>();

  for (const run of world.runs.values()) {
    const note = ownerOf(world.notes, run);
    if (!note) continue;

    owner.set(run.id, note.key);
    claimed.add(run.id);
  }

  for (const note of world.notes) {
    const runs = [...world.runs.values()]
      .filter((run) => owner.get(run.id) === note.key)
      .sort(
        (left, right) =>
          ranked(left).localeCompare(ranked(right)) || named(left).localeCompare(named(right)),
      );

    if (runs.length === 0) {
      composed.push({
        key: note.key,
        at: note.at,
        content: note.content,
        merges: !isFoldable(note.kind),
      });

      continue;
    }

    const board = CommitBoard({
      entries: runs.map(toBoard) as CommitBoardEntry[],
      repository: note.repository ?? runs[0]?.repository ?? repository,
    }) as { components?: unknown[] };

    const content = note.content as { components?: unknown[] };

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
    if (claimed.has(run.id)) continue;

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
