import { HookScope, refDisplay, Repository } from "../refs";

export function Ref({
  repository,
  refName,
  within,
  hook,
  established,
}: {
  repository: Repository;
  refName: string;
  within?: Repository;
  hook?: HookScope;
  established?: boolean;
}): string {
  const { text, href } = refDisplay({ ref: refName, repository, within, hook, established });

  return <a href={href}>{text}</a>;
}
