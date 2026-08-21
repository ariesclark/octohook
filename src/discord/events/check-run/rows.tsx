import { checkMark, deploymentMark, lead } from "../../marks";
import { t, tOf } from "../../messages.ts";
import { summarise } from "../../../markdown/summary";
import { annotationText, bySeverity, fileUrl, fold } from "./annotations.ts";
import { meetsAnnotationLevel } from "./run";
import { checkDuration } from "./shared";

/**
 * Everything a run contains steps into a quote, which is the one indent Discord draws a bar
 * beside — two ordinary spaces in a proportional font read as no indent at all. The run's own
 * name stays at the margin, so the bar marks exactly what belongs to it.
 */
const indent = "> ";

/** A line beneath a job: what the job said, and what it deployed. */
const detail = "> ";

export type BoardJob = {
  name: string;
  url: string;
  conclusion: string | null;
  startedAt: string | null;
  completedAt: string | null;
  annotations?: Array<{
    path: string;
    startLine: number;
    level: string;
    title: string | null;
    message: string;
  }>;
  output?: { title?: string; summary?: string };
};

/** Past this, a check is explaining itself at length and its own page reads better. */
const longestOutput = 140;

/**
 * What a check said about itself, rather than about the code: a deployed url, a count of alerts,
 * a warning about its own configuration. The summary is GitHub-flavoured markdown, so it goes
 * through the same reader as a pull request body — which also drops the relative links GitHub
 * writes into it, since a link relative to github.com means nothing in a Discord message.
 */
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
  /** The job that did the deploying, so a deployment can be shown as that job's doing. */
  jobUrl?: string;
};

const failed = new Set(["failure", "timed_out", "startup_failure", "action_required"]);

/** A failure earns the room to explain itself; a warning on a passing job does not. */
const shown = { failed: 5, passed: 2 };

function jobFailed(job: BoardJob): boolean {
  return failed.has(job.conclusion ?? "");
}

/** A deployment that has announced itself but has nowhere to visit yet. */
export const underway = new Set(["in_progress", "queued", "pending"]);

/**
 * A deployment nobody can visit yet is not worth a row: it says a job is running, which the job
 * already said. It earns one once it has somewhere to point at, or once it has failed to get
 * there — until then it is counted in the summary instead, so it is still visible.
 */
export function arrived(deployments: BoardDeployment[]): BoardDeployment[] {
  return deployments.filter(({ state }) => !underway.has(state));
}

/** What a job deployed, when the status said which job did it. */
function deploymentsOf(job: BoardJob, deployments: BoardDeployment[] = []) {
  return arrived(deployments).filter(({ jobUrl }) => jobUrl && jobUrl === job.url);
}

/**
 * Whether a job said anything of its own: a warning about the code, or a word about itself. A
 * job that did is worth drawing however it went — "Preview deployed" is the whole point of the
 * check that says it, and it says it while passing.
 */
function jobTalks(job: BoardJob): boolean {
  return (
    fold((job.annotations ?? []).filter(meetsAnnotationLevel)).length > 0 || Boolean(outputOf(job))
  );
}

/** Whether anything is drawn beneath a job, including what it deployed. */
function jobSpeaks(job: BoardJob, deployments: BoardDeployment[] = []): boolean {
  return jobTalks(job) || deploymentsOf(job, deployments).length > 0;
}

/** What deployed with no job to hang from: a status that named none, or a job not being shown. */
function looseDeployments(jobs: BoardJob[], deployments: BoardDeployment[] = []) {
  const urls = new Set(jobs.map(({ url }) => url));

  return arrived(deployments).filter(({ jobUrl }) => !jobUrl || !urls.has(jobUrl));
}

/** Every row after the first opens with a line break; the first would open a gap. */
function Break({ first }: { first: boolean }) {
  return first ? "" : <br />;
}

/**
 * What a job said, under the line that named it. A row is a fact — this passed, that failed —
 * and the annotations are the only place the log ever says why.
 */
function Annotations({
  job,
  repositoryUrl,
  sha,
}: {
  job: BoardJob;
  repositoryUrl: string;
  sha?: string;
}) {
  const folded = fold((job.annotations ?? []).filter(meetsAnnotationLevel)).sort(bySeverity);
  const listed = folded.slice(0, jobFailed(job) ? shown.failed : shown.passed);
  const rest = folded.length - listed.length;

  return listed.flatMap((annotation, index) => {
    const url = sha ? fileUrl(annotation, repositoryUrl, sha) : undefined;

    const line = (
      <>
        {detail}
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
            <small>
              {detail}
              {"- "}
              {t("annotation.more", { count: rest })}
            </small>,
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
  /** A deployment a job performed belongs under it, where what the job said also goes. */
  under?: boolean;
  first?: boolean;
}) {
  return (
    <>
      <Break first={first} />
      {under ? detail : indent}
      {under ? "- " : ""}
      {lead(deploymentMark(deployment.state))}
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
  spaced,
}: Rows & { job: BoardJob; first: boolean; spaced: boolean }) {
  const duration = checkDuration(job.startedAt, job.completedAt);
  const said = outputOf(job);

  return (
    <>
      <Break first={first} />
      {indent}
      {checkMark(job.conclusion)}
      <a href={job.url}>{job.name}</a>
      {duration ? ` • ${duration}` : ""}
      {said ? (
        <>
          <br />
          {detail}
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
      {spaced ? (
        <>
          <br />
          {indent}
        </>
      ) : (
        ""
      )}
    </>
  );
}

/**
 * How a run is doing, said once. Every style wants this on the line that names the run rather
 * than on a line of its own underneath, where it says the same thing twice.
 */
export function runSummary(
  jobs: BoardJob[],
  deployments: BoardDeployment[] = [],
): string | undefined {
  const deploying = deployments.filter(({ state }) => underway.has(state)).length;
  const shipping = deploying > 0 ? t("run.deploying", { count: deploying }) : undefined;

  const broken = jobs.filter(jobFailed).length;
  const running = jobs.filter(({ conclusion }) => !conclusion).length;

  // A job nobody ran is not a job that passed, however green the rest of the run looks.
  const skipped = jobs.filter(({ conclusion }) => conclusion === "skipped").length;
  const passed = jobs.length - broken - running - skipped;

  return [
    broken > 0 ? t("run.failed", { count: broken }) : undefined,
    running > 0 ? t("run.running", { count: running }) : undefined,
    passed > 0 ? t("run.passed", { count: passed }) : undefined,
    skipped > 0 ? t("run.skipped", { count: skipped }) : undefined,
    shipping,
  ]
    .filter(Boolean)
    .join(", ");
}

type Rows = {
  jobs: BoardJob[];
  /** Drawn alongside the jobs: under the job that performed it, or under the run if none did. */
  deployments?: BoardDeployment[];
  repositoryUrl: string;
  sha?: string;
};

/**
 * What went wrong, what a check chose to say, and what deployed. How the rest of the run went is
 * on the line above: a run of quiet green jobs draws nothing here at all.
 */
export function JobRows(rows: Rows) {
  const drawn = rows.jobs.filter((job) => jobFailed(job) || jobTalks(job));
  const loose = looseDeployments(drawn, rows.deployments);

  if (drawn.length + loose.length === 0) return [];

  // A job that said something is a block, not a row; the next one starts far enough away to
  // read as its own.
  const last = drawn.length + loose.length - 1;

  return [
    ...drawn.map((job, index) => (
      <Job
        {...rows}
        job={job}
        first={index === 0}
        spaced={index < last && jobSpeaks(job, rows.deployments)}
      />
    )),
    ...loose.map((deployment, index) => (
      <Deployment deployment={deployment} first={drawn.length === 0 && index === 0} />
    )),
  ];
}
