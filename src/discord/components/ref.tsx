import { HookScope, refDisplay, Repository } from "../refs";

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
