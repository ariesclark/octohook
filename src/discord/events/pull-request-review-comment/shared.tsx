import { GithubEvent } from "../../../github";

export type ReviewCommentEvent = Extract<
  GithubEvent,
  { type: `pull_request_review_comment.${string}` }
>;

/** How many lines of the diff are drawn above a comment left on a single line. */
const context = 2;

/** Past this the diff stops being a quotation and becomes the whole file. */
const mostRows = 16;

/**
 * GitHub sends the whole hunk but draws only the lines the comment covers, so a note on one line
 * is a few rows rather than the twenty that happened to precede it.
 */
export function hunkAround(
  hunk: string,
  comment: { line?: number | null; start_line?: number | null },
): string | undefined {
  const rows = hunk.replaceAll("\r", "").split("\n");
  const { line, start_line: start } = comment;

  const header = rows[0]?.startsWith("@@") ? rows[0] : undefined;
  if (!line) return undefined;

  const from = start && start !== line ? start : line - context;

  // Only a kept or added row occupies a line on the new side; a removal keeps its neighbours' place.
  let number = Number(header?.match(/\+(\d+)/)?.[1] ?? 1) - 1;
  const kept: string[] = [];

  for (const row of rows.slice(header ? 1 : 0)) {
    const removal = row.startsWith("-");
    if (!removal) number += 1;

    const at = removal ? number + 1 : number;
    if (at >= from && at <= line) kept.push(row);
  }

  // A row is a marker and its line; one with nothing after the marker is blank on either side.
  const carrying = kept.filter((row) => row.slice(1).trim().length > 0);

  if (carrying.length === 0 || carrying.length > mostRows) return undefined;

  return carrying.join("\n");
}

/** A fenced diff, built without interpolation so the fence is not read as user-facing copy. */
export function diffBlock(hunk: string): string {
  return ["```diff", hunk, "```"].join("\n");
}

export function commentLocation(comment: {
  path?: string | null;
  line?: number | null;
  start_line?: number | null;
}): string | undefined {
  const { path, line, start_line: start } = comment;
  if (!path) return undefined;
  if (!line) return path;

  return start && start !== line ? `${path}:${start}-${line}` : `${path}:${line}`;
}
