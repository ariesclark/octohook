type ContributionCommit = {
  author?: { username?: string };
  added?: string[];
  removed?: string[];
  modified?: string[];
};

/** A push says nothing about lines changed. */
export function authorsByContribution(commits: readonly ContributionCommit[]): string[] {
  const tallies = new Map<string, { commits: number; files: number; first: number }>();

  for (const [index, commit] of commits.entries()) {
    const username = commit.author?.username;
    if (!username) continue;

    const touched =
      (commit.added?.length ?? 0) + (commit.removed?.length ?? 0) + (commit.modified?.length ?? 0);

    const tally = tallies.get(username) ?? { commits: 0, files: 0, first: index };
    tallies.set(username, {
      commits: tally.commits + 1,
      files: tally.files + touched,
      first: tally.first,
    });
  }

  return [...tallies]
    .sort(
      ([, left], [, right]) =>
        right.commits - left.commits || right.files - left.files || left.first - right.first,
    )
    .map(([username]) => username);
}
