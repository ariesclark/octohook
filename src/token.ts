/**
 * How broad a hook's GitHub token is allowed to be. The token arrives on the hook's own url, so
 * whoever configures a hook chooses it — and a url is a place a credential is easy to be careless
 * with. A token that can do more than octohook asks of it is refused rather than used.
 */

/**
 * Everything the two lookups need, and nothing else. `resolveRun` and `resolveAnnotations` read
 * `/repos/…/actions/runs/…` and `/repos/…/check-runs/…/annotations`; on a private repository that
 * takes `repo`, and on a public one `public_repo` or no scope whatever.
 *
 * A fine-grained token is the better answer and needs neither: Actions read and Checks read.
 */
const needed = new Set(["repo", "public_repo"]);

/** One verdict per token, for the life of the isolate. */
const verdicts = new Map<string, string[]>();

/**
 * The scopes a token carries that the lookups have no use for, empty when there are none.
 *
 * `/rate_limit` is the cheapest way to ask: it answers for any token and is the one endpoint that
 * does not count against the limit it reports.
 */
export async function excessScopes(token: string): Promise<string[]> {
  const known = verdicts.get(token);
  if (known) return known;

  const response = await fetch("https://api.github.com/rate_limit", {
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "user-agent": "octohook",
    },
  });

  // Refusing every delivery because GitHub is having a bad minute trades a real outage for a
  // question about how broad the operator's own credential is. Asked again next time.
  if (!response.ok) return [];

  const scopes = response.headers.get("x-oauth-scopes");

  // A fine-grained or app token sends no scopes header at all: what it may do was decided when it
  // was made, and there is no list here to be too long.
  const excess =
    scopes === null
      ? []
      : scopes
          .split(",")
          .map((scope) => scope.trim())
          .filter((scope) => scope.length > 0 && !needed.has(scope));

  verdicts.set(token, excess);
  return excess;
}

export const neededScopes = [...needed];
