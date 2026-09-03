import { displayUsername, PushCommit } from "./shared";

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
    const cost = Math.max(1, Math.ceil(commitWidth(commit, { showAuthor, omitAuthor }) / width));
    if (used + cost > rows) break;

    used += cost;
    taken += 1;
  }

  return Math.max(1, taken);
}
