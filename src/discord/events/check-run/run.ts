/**
 * A check run says nothing about the workflow that ran it — no name, no number, no trigger.
 * The only handle is the run id inside its `details_url`, which the API can turn back into all
 * three. Everything here is optional: without a token the log renders exactly as it does now.
 */

export type RunReference = {
  repository: string;
  runId: string;
};

/** `https://github.com/<owner>/<repo>/actions/runs/<id>/job/<id>` and nothing else. */
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

let token: string | undefined;

export function setGithubToken(value?: string) {
  token = value;
}

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

export type ResolvedRun = {
  /** As the API gives it: a path when the workflow was never named. */
  name: string;
  runNumber: number;
  trigger: string;
};

const runs = new Map<string, Promise<ResolvedRun | undefined>>();

/** One request per run, however many of its jobs report in. */
export function resolveRun(reference: RunReference): Promise<ResolvedRun | undefined> {
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
}

const suites = new Map<string, Promise<RunReference | undefined>>();

/**
 * A check created through the Checks API rather than by a job carries the short `/runs/<id>`
 * url, which names no run — but it still belongs to a check suite, and a suite belongs to one
 * workflow run. This is the way back for a check that would otherwise stand alone.
 */
export function runReferenceFromSuite(
  repository: string,
  suiteId: number,
): Promise<RunReference | undefined> {
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
}

export type Annotation = {
  path: string;
  startLine: number;
  level: string;
  title: string | null;
  message: string;
};

export async function resolveAnnotations(
  repository: string,
  checkRunId: number,
): Promise<Annotation[]> {
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
}

/**
 * GitHub's three annotation levels, in the order a reader cares about them. A notice is a
 * tool talking about itself — a version, a count — so the floor sits above it.
 */
const levels: Record<string, number> = {
  notice: 0,
  warning: 1,
  failure: 2,
};

/** A level this does not know ranks with a warning: more likely news than noise. */
export function severity(level: string): number {
  return levels[level] ?? levels.warning!;
}

/**
 * A notice is a tool talking about itself — a version, a count — and never what a reader came
 * for. A level this does not know is more likely news than noise, so it is never the one dropped.
 */
export function meetsAnnotationLevel({ level }: Annotation): boolean {
  return severity(level) >= levels.warning!;
}
