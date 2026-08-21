/** What GitHub's `x-github-hook-installation-target-type` says the webhook was installed on. */
export type HookScope = "organization" | "repository";

export type Repository = { html_url: string; name: string; full_name?: string };

type RefKind = "branch" | "pull" | "commit";

/**
 * A git ref reaches us in several shapes, and only one of them is a branch. A pull request
 * build carries `refs/pull/N/merge`, which has no tree to link to; a pinned deployment carries
 * a bare sha. Each needs its own destination and its own name, or the link lands on a 404 and
 * the label reads as machinery.
 */
export function refTarget(ref: string): { label: string; path: string; kind: RefKind } {
  const pull = ref.match(/^refs\/pull\/(\d+)\/(?:merge|head)$/);
  if (pull) return { label: pull[1]!, path: `pull/${pull[1]}`, kind: "pull" };

  if (/^[\da-f]{40}$/i.test(ref))
    return { label: ref.slice(0, 7), path: `commit/${ref}`, kind: "commit" };

  const named = ref.replace(/^refs\/(heads|tags)\//, "");
  return { label: named, path: `tree/${named}`, kind: "branch" };
}

/**
 * Check runs and deployments carry the pull requests they belong to. When there is exactly
 * one, it says more than the branch does — a reader can open it and see the change — so the
 * ref becomes the pull request. Several pull requests on one branch have no single answer,
 * and the branch stays.
 */
export function preferredRef(ref: string, pulls?: readonly ({ number: number } | null)[]): string {
  if (pulls?.length !== 1) return ref;

  const [pull] = pulls;
  return pull ? `refs/pull/${pull.number}/head` : ref;
}

/** How GitHub itself joins a repository to each kind of ref. */
const separators: Record<RefKind, string> = {
  branch: ":",
  pull: "#",
  commit: "@",
};

/**
 * How much of a ref's address needs saying depends on where the webhook was installed. An
 * organization hook carries events from every repository, so the repository is news; a
 * repository hook only ever speaks about one, so naming it on every line is noise. Either way
 * a ref that lives somewhere else — a fork — has to say so, or it reads as one of ours.
 */
export function refDisplay({
  ref,
  repository,
  within,
  hook = "repository",
}: {
  ref: string;
  /** Where the ref lives. */
  repository: Repository;
  /** The repository the message is about, when it differs from where the ref lives. */
  within?: Repository;
  hook?: HookScope;
}): { text: string; href: string } {
  const { label, path, kind } = refTarget(ref);
  const href = `${repository.html_url}/${path}`;

  const elsewhere = Boolean(within) && repository.full_name !== within!.full_name;

  const prefix = elsewhere
    ? (repository.full_name ?? repository.name)
    : hook === "organization"
      ? repository.name
      : "";

  if (!prefix) return { text: kind === "pull" ? `#${label}` : label, href };

  return { text: `${prefix}${separators[kind]}${label}`, href };
}
