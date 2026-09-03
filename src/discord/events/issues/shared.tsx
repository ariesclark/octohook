import { GithubEvent } from "../../../github";

export type IssuesEvent = Extract<GithubEvent, { type: `issues.${string}` }>;

export function issueLabels(labels: ({ name: string } | null)[] | undefined): string | undefined {
  const names = (labels ?? []).filter((label) => label !== null).map(({ name }) => name);
  if (names.length === 0) return undefined;

  return names.slice(0, 5).join(", ");
}
