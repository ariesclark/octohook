export type RunReference = {
  repository: string;
  runId: string;
};

export function runReferenceFrom(detailsUrl: string): RunReference | undefined {
  let pathname: string;

  try {
    ({ pathname } = new URL(detailsUrl));
  } catch {
    return undefined;
  }

  const [, owner, repository, actions, runs, runId] = pathname.split("/");
  if (actions !== "actions" || runs !== "runs" || !owner || !repository || !runId) return undefined;

  return { repository: `${owner}/${repository}`, runId };
}

export type ResolvedRun = {
  name: string;
  runNumber: number;
  trigger: string;
};

export type Annotation = {
  path: string;
  startLine: number;
  level: string;
  title: string | null;
  message: string;
};

export type Github = {
  resolveRun(reference: RunReference): Promise<ResolvedRun | undefined>;
  runReferenceFromSuite(repository: string, suiteId: number): Promise<RunReference | undefined>;
  resolveAnnotations(repository: string, checkRunId: number): Promise<Annotation[]>;
};

/** A Durable Object shares its isolate with every other instance of its class. */
export function createGithub(token?: string): Github {
  const runs = new Map<string, Promise<ResolvedRun | undefined>>();
  const suites = new Map<string, Promise<RunReference | undefined>>();

  async function get<T>(path: string): Promise<T | undefined> {
    if (!token) return undefined;

    const response = await fetch(`https://api.github.com${path}`, {
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
        "user-agent": "octohook",
      },
    });

    if (!response.ok) return undefined;
    return (await response.json()) as T;
  }

  return {
    resolveRun(reference: RunReference): Promise<ResolvedRun | undefined> {
      const key = `${reference.repository}/${reference.runId}`;
      const pending = runs.get(key);
      if (pending) return pending;

      const request = get<{ name: string; run_number: number; event: string }>(
        `/repos/${reference.repository}/actions/runs/${reference.runId}`,
      ).then((run) =>
        run ? { name: run.name, runNumber: run.run_number, trigger: run.event } : undefined,
      );

      runs.set(key, request);
      return request;
    },

    /** A check created through the Checks API carries the short `/runs/<id>` url, naming no run. */
    runReferenceFromSuite(repository: string, suiteId: number): Promise<RunReference | undefined> {
      const key = `${repository}/${suiteId}`;
      const pending = suites.get(key);
      if (pending) return pending;

      const request = get<{ workflow_runs: Array<{ id: number }> }>(
        `/repos/${repository}/actions/runs?check_suite_id=${suiteId}`,
      ).then((found) => {
        const [first] = found?.workflow_runs ?? [];
        return first ? { repository, runId: String(first.id) } : undefined;
      });

      suites.set(key, request);
      return request;
    },

    async resolveAnnotations(repository: string, checkRunId: number): Promise<Annotation[]> {
      const annotations = await get<
        Array<{
          path: string;
          start_line: number;
          annotation_level: string;
          title: string | null;
          message: string;
        }>
      >(`/repos/${repository}/check-runs/${checkRunId}/annotations`);

      return (annotations ?? []).map(({ path, start_line, annotation_level, title, message }) => ({
        path,
        startLine: start_line,
        level: annotation_level,
        title,
        message,
      }));
    },
  };
}

const levels: Record<string, number> = {
  notice: 0,
  warning: 1,
  failure: 2,
};

export function severity(level: string): number {
  return levels[level] ?? levels.warning!;
}

export function meetsAnnotationLevel({ level }: Annotation): boolean {
  return severity(level) >= levels.warning!;
}
