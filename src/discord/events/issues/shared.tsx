import { GithubEvent } from "../../../github";

export type IssuesEvent = Extract<GithubEvent, { type: `issues.${string}` }>;

export function excerpt(body: string | null | undefined, limit = 140): string | undefined {
  if (!body) return undefined;

  const [line = ""] = body.replaceAll("\r", "").split("\n");
  const flattened = line.replaceAll("`", "'").trim();
  if (!flattened) return undefined;

  return flattened.length > limit ? `${flattened.slice(0, limit - 1)}…` : flattened;
}

export function issueLabels(labels: ({ name: string } | null)[] | undefined): string | undefined {
  const names = (labels ?? []).filter((label) => label !== null).map(({ name }) => name);
  if (names.length === 0) return undefined;

  return names.slice(0, 5).join(", ");
}
