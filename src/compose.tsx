import {
  CommitBoard,
  RunBoard,
  type Board,
  type CommitBoardEntry,
} from "./discord/events/check-run/board";
import { workflowName } from "./discord/events/workflow-run/shared";
import type { HookScope } from "./discord/refs";
import { isFoldable } from "./foldable.ts";
import { mergeAdjacent } from "./merge.ts";
import { ownerOf, type Repository, type Run, type World } from "./state.ts";

/**
 * The whole channel, drawn from the world every time. Nothing here knows which event just
 * arrived or what was on screen a moment ago: the same world always draws the same messages,
 * so an event only has to be folded in correctly for the channel to be right.
 */

export type Composed = {
  /** Stable across renders, so delivery can keep giving the same message to the same content. */
  key: string;
  at: string;
  content: unknown;
  /** Whether this can join the message before it, which only a finished thing can. */
  merges?: boolean;
};

/** How far apart two things may be said and still read as one message. */
const mergeWindow = 60_000;

/** A run with no workflow behind it sorts under what it calls itself, and last of all. */
function named(run: Run): string {
  return run.run ? `0${workflowName(run.run.name)}` : `1${run.title ?? run.id}`;
}

function toBoard(run: Run): Board & { runId: string } {
  return {
    runId: run.id,
    run: run.run,
    title: run.title,
    sha: run.sha,
    branch: run.branch,
    jobs: run.jobs,
    deployments: run.deployments,
  };
}

/**
 * An organisation hook feeds one channel from every repository it covers, and every link a board
 * draws is built from a repository url — so each entry answers for itself, and the caller's
 * repository is only what an entry that never learned one falls back to.
 */
export function compose(world: World, repository: Repository, hook?: HookScope): Composed[] {
  const composed: Composed[] = [];

  // A run belongs to one note, not to every note that mentions its commit.
  const owner = new Map<string, string>();
  const claimed = new Set<string>();

  for (const run of world.runs.values()) {
    const note = ownerOf(world.notes, run);
    if (!note) continue;

    owner.set(run.id, note.key);
    claimed.add(run.id);
  }

  for (const note of world.notes) {
    // Insertion order is whichever run's first job GitHub happened to deliver first, so the same
    // commit reads differently every time. Name is fixed for a run's whole life, where a sort on
    // how it is going would move a row the moment it went red — under a reader's eye, mid-run.
    const runs = [...world.runs.values()]
      .filter((run) => owner.get(run.id) === note.key)
      .sort((left, right) => named(left).localeCompare(named(right)));

    if (runs.length === 0) {
      composed.push({
        key: note.key,
        at: note.at,
        content: note.content,
        // A push has runs coming even when none has arrived; a star never will.
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

  // A run nothing claimed: a scheduled workflow, a check from an app, or one whose push has not
  // arrived yet. It says what it is on its own until something claims it.
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
