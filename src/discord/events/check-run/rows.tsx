import { t, tOf } from "../../messages.ts";
import { summarise } from "../../../markdown/summary";
import { annotationText, bySeverity, visible } from "./annotations.ts";
import { fileUrl } from "./annotations.ts";
import { arrived, said, underway } from "./facts.ts";
import { checkDuration } from "./shared";

const small = "-# ";

export type BoardJob = {
  name: string;
  url: string;
  conclusion: string | null;
  startedAt: string | null;
  completedAt: string | null;
  /** The step it is on, while it is still on one. */
  step?: string;
  annotations?: Array<{
    path: string;
    startLine: number;
    level: string;
    title: string | null;
    message: string;
  }>;
  output?: { title?: string; summary?: string };
};

const longestOutput = 140;

function outputOf(job: BoardJob): string | undefined {
  const { title, summary } = job.output ?? {};
  const said = summary ? summarise(summary, longestOutput) : undefined;

  if (!title) return said;
  if (!said || said === title) return title;

  return `${title} — ${said}`;
}

export type BoardDeployment = {
  id: number;
  state: string;
  place: string;
  url?: string;
  jobUrl?: string;
};

const failed = new Set(["failure", "timed_out", "startup_failure", "action_required"]);

const shown = { failed: 5, passed: 2 };

function jobFailed(job: BoardJob): boolean {
  return failed.has(job.conclusion ?? "");
}

export { arrived, underway };

function deploymentsOf(job: BoardJob, deployments: BoardDeployment[] = []) {
  return arrived(deployments).filter(({ jobUrl }) => jobUrl && jobUrl === job.url);
}

function jobTalks(job: BoardJob): boolean {
  return visible(job).length > 0 || said(job);
}

/** A job is on a step only until it has a verdict; after that the step is history. */
function stepOf(job: BoardJob): string | undefined {
  return job.conclusion ? undefined : job.step;
}

function jobSpeaks(job: BoardJob, deployments: BoardDeployment[] = []): boolean {
  return Boolean(stepOf(job)) || jobTalks(job) || deploymentsOf(job, deployments).length > 0;
}

function looseDeployments(jobs: BoardJob[], deployments: BoardDeployment[] = []) {
  const urls = new Set(jobs.map(({ url }) => url));

  return arrived(deployments).filter(({ jobUrl }) => !jobUrl || !urls.has(jobUrl));
}

function Break({ first }: { first: boolean }) {
  return first ? "" : <br />;
}

function Annotations({
  job,
  repositoryUrl,
  sha,
}: {
  job: BoardJob;
  repositoryUrl: string;
  sha?: string;
}) {
  const folded = visible(job).sort(bySeverity);
  const listed = folded.slice(0, jobFailed(job) ? shown.failed : shown.passed);
  const rest = folded.length - listed.length;

  return listed.flatMap((annotation, index) => {
    const url = sha ? fileUrl(annotation, repositoryUrl, sha) : undefined;

    const line = (
      <>
        {small}
        {"- "}
        {url ? (
          <a href={url}>
            <code>
              {annotation.path}:{annotation.startLine}
            </code>
          </a>
        ) : (
          ""
        )}
        {url ? " " : ""}
        {annotationText(annotation)}
        {annotation.count > 1 ? ` ${t("annotation.repeats", { count: annotation.count })}` : ""}
      </>
    );

    return [
      <br />,
      line,
      ...(rest > 0 && index === listed.length - 1
        ? [
            <br />,
            <>
              {small}
              {"- "}
              {t("annotation.more", { count: rest })}
            </>,
          ]
        : []),
    ];
  });
}

function Deployment({
  deployment,
  under,
  first = false,
}: {
  deployment: BoardDeployment;
  under?: boolean;
  first?: boolean;
}) {
  return (
    <>
      <Break first={first} />
      {small}
      {under ? "- " : ""}
      {tOf("deployment", deployment.state)}{" "}
      {deployment.url ? <a href={deployment.url}>{deployment.place}</a> : deployment.place}
    </>
  );
}

function Job({
  job,
  repositoryUrl,
  sha,
  deployments,
  first,
}: Rows & { job: BoardJob; first: boolean }) {
  const duration = checkDuration(job.startedAt, job.completedAt);
  const step = stepOf(job);
  const said = outputOf(job);

  return (
    <>
      <Break first={first} />
      {small}
      <a href={job.url}>{job.name}</a>
      {step ? ` • ${step}` : duration ? ` • ${duration}` : ""}
      {said ? (
        <>
          <br />
          {small}
          {"- "}
          {said}
        </>
      ) : (
        ""
      )}
      <Annotations job={job} repositoryUrl={repositoryUrl} sha={sha} />
      {deploymentsOf(job, deployments).map((deployment) => (
        <Deployment deployment={deployment} under />
      ))}
    </>
  );
}

export function runSummary(
  jobs: BoardJob[],
  deployments: BoardDeployment[] = [],
  ran?: { startedAt?: string | null; completedAt?: string | null },
): string | undefined {
  const deploying = deployments.filter(({ state }) => underway.has(state)).length;
  const shipping = deploying > 0 ? t("run.deploying", { count: deploying }) : undefined;

  const broken = jobs.filter(jobFailed).length;
  const running = jobs.filter(({ conclusion }) => !conclusion).length;

  const skipped = jobs.filter(({ conclusion }) => conclusion === "skipped").length;
  const passed = jobs.length - broken - running - skipped;

  const counted = [
    broken > 0 ? t("run.failed", { count: broken }) : undefined,
    running > 0 ? t("run.running", { count: running }) : undefined,
    passed > 0 ? t("run.passed", { count: passed }) : undefined,
    skipped > 0 ? t("run.skipped", { count: skipped }) : undefined,
    shipping,
  ]
    .filter(Boolean)
    .join(", ");

  // A run with work still in it has no length yet, whatever an earlier fold wrote down.
  const over = jobs.every(({ conclusion }) => conclusion);
  const duration = over
    ? checkDuration(ran?.startedAt ?? null, ran?.completedAt ?? null)
    : undefined;
  const took = duration ? t("check.took", { duration }) : undefined;

  if (!took) return counted;
  return counted ? `${counted} ${took}` : took;
}

type Rows = {
  jobs: BoardJob[];
  deployments?: BoardDeployment[];
  repositoryUrl: string;
  sha?: string;
};

export function JobRows(rows: Rows) {
  const drawn = rows.jobs.filter((job) => jobFailed(job) || jobSpeaks(job, rows.deployments));
  const loose = looseDeployments(drawn, rows.deployments);

  if (drawn.length + loose.length === 0) return [];

  return [
    ...drawn.map((job, index) => <Job {...rows} job={job} first={index === 0} />),
    ...loose.map((deployment, index) => (
      <Deployment deployment={deployment} first={drawn.length === 0 && index === 0} />
    )),
  ];
}
