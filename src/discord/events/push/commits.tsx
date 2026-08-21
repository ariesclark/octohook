import { displayUsername, PushCommit } from "./shared";

/** High enough that a real subject survives whole; a cut-off subject reads worse than a long one. */
const subjectLimit = 128;

function firstLine(message: string): string {
  const [line = ""] = message.split("\n");
  const flattened = line.replaceAll("`", "'");

  return flattened.length > subjectLimit ? `${flattened.slice(0, subjectLimit - 1)}…` : flattened;
}

function profileUrl(username: string): string {
  const appSlug = username.match(/^(.+)\[bot\]$/)?.[1];
  if (appSlug) return `https://github.com/apps/${encodeURIComponent(appSlug)}`;

  return `https://github.com/${encodeURIComponent(username)}`;
}

export function hasSingleAuthor(commits: PushCommit[]): boolean {
  return new Set(commits.map(({ author }) => author.username ?? author.name)).size <= 1;
}

export function CommitLine({
  commit: { id, url, message, author },
  codeMessage = false,
  showAuthor = true,
  omitAuthor,
}: {
  commit: PushCommit;
  codeMessage?: boolean;
  showAuthor?: boolean;
  omitAuthor?: string;
}): string {
  return (
    <>
      <a href={url}>
        <code>{id.slice(0, 7)}</code>
      </a>{" "}
      {codeMessage ? <code>{firstLine(message)}</code> : firstLine(message)}
      {showAuthor && author.username !== omitAuthor ? (
        <>
          {" – "}
          {author.username ? (
            <a href={profileUrl(author.username)}>{displayUsername(author.username)}</a>
          ) : (
            author.name
          )}
        </>
      ) : (
        ""
      )}
    </>
  );
}

function commitWidth(
  commit: PushCommit,
  { showAuthor = true, omitAuthor }: { showAuthor?: boolean; omitAuthor?: string } = {},
): number {
  const { id, message, author } = commit;
  const named = showAuthor && author.username !== omitAuthor;
  const who = author.username ? displayUsername(author.username) : author.name;

  return id.slice(0, 7).length + 1 + firstLine(message).length + (named ? 3 + who.length : 0);
}

/**
 * A thumbnail is taller than the one line the section used to hold, and the section pads to
 * clear it — so the lines beside it come free, while the gap below does not. Takes commits
 * while they fit the narrowed column, in order, stopping at the first that would wrap.
 */
export function besideThumbnail(
  commits: PushCommit[],
  {
    rows,
    width,
    showAuthor,
    omitAuthor,
  }: { rows: number; width: number; showAuthor?: boolean; omitAuthor?: string },
): number {
  let used = 0;
  let taken = 0;

  for (const commit of commits) {
    // Three short commits and one long one take the same room; what counts is rows, not lines.
    const cost = Math.max(1, Math.ceil(commitWidth(commit, { showAuthor, omitAuthor }) / width));
    if (used + cost > rows) break;

    used += cost;
    taken += 1;
  }

  // A section holding only the headline is the gap this exists to avoid.
  return Math.max(1, taken);
}

/**
 * Half a message's width is links nobody sees, so a count of commits is a poor proxy for how
 * much room they take. This fits as many rendered lines as the budget holds, and the overflow
 * line has to fit too — otherwise trimming to make room for it takes the room it needed.
 */
