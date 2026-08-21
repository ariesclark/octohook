import { HookScope, refDisplay, Repository } from "../refs";

/**
 * One ref, rendered the same way wherever it appears: named the way GitHub names it, linked to
 * something that exists, and carrying only the part of its address the reader does not already
 * know — which depends on whether this webhook watches one repository or a whole organization.
 */
export function Ref({
  repository,
  refName,
  within,
  hook,
}: {
  repository: Repository;
  refName: string;
  within?: Repository;
  hook?: HookScope;
}): string {
  const { text, href } = refDisplay({ ref: refName, repository, within, hook });

  return <a href={href}>{text}</a>;
}
