export type HookScope = "organization" | "repository";

export type Repository = { html_url: string; name: string; full_name?: string };

type RefKind = "branch" | "pull" | "commit";

/** A pull request build carries `refs/pull/N/merge`, which has no tree to link to. */
export function refTarget(ref: string): { label: string; path: string; kind: RefKind } {
  const pull = ref.match(/^refs\/pull\/(\d+)\/(?:merge|head)$/);
  if (pull) return { label: pull[1]!, path: `pull/${pull[1]}`, kind: "pull" };

  if (/^[\da-f]{40}$/i.test(ref))
    return { label: ref.slice(0, 7), path: `commit/${ref}`, kind: "commit" };

  const named = ref.replace(/^refs\/(heads|tags)\//, "");
  return { label: named, path: `tree/${named}`, kind: "branch" };
}

export function pullRef(number: number): string {
  return `refs/pull/${number}/head`;
}

export function preferredRef(ref: string, pulls?: readonly ({ number: number } | null)[]): string {
  if (pulls?.length !== 1) return ref;

  const [pull] = pulls;
  return pull ? `refs/pull/${pull.number}/head` : ref;
}

const separators: Record<RefKind, string> = {
  branch: ":",
  pull: "#",
  commit: "@",
};

export function refDisplay({
  ref,
  repository,
  within,
  hook = "repository",
  established = false,
}: {
  ref: string;
  repository: Repository;
  within?: Repository;
  hook?: HookScope;
  /** Whether the message has already named this repository, leaving nothing for a prefix to say. */
  established?: boolean;
}): { text: string; href: string } {
  const { label, path, kind } = refTarget(ref);
  const href = `${repository.html_url}/${path}`;

  const elsewhere = Boolean(within) && repository.full_name !== within!.full_name;

  const prefix = elsewhere
    ? (repository.full_name ?? repository.name)
    : hook === "organization" && !established
      ? repository.name
      : "";

  if (!prefix) return { text: kind === "pull" ? `#${label}` : label, href };

  return { text: `${prefix}${separators[kind]}${label}`, href };
}
