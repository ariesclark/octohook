export function RepositoryName({
  repository,
}: {
  repository: { full_name: string; html_url: string };
}): string {
  return (
    <b>
      <a href={repository.html_url}>{repository.full_name}</a>
    </b>
  );
}
