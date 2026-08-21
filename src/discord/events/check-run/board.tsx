import { Ref } from "../../components/ref";
import { lead, marks } from "../../marks";
import { t } from "../../messages.ts";
import { HookScope, preferredRef } from "../../refs";
import { WebhookContent } from "../../types";
import { triggerLabel, workflowName } from "../workflow-run/shared";
import { JobRows, runSummary, underway, type BoardDeployment, type BoardJob } from "./rows";
import { ResolvedRun } from "./run";

// GitHub Actions app id, matching how workflow runs identify themselves.
const actionsAvatarUrl = "https://avatars.githubusercontent.com/in/15368";

export type { BoardJob };

export type { BoardDeployment };

export type Board = {
  run?: ResolvedRun;
  /** The workflow run's own id, so the line that names it can link to it. */
  runId?: string;
  /** What to call a set of checks no workflow run claims: the app that posted them. */
  title?: string;
  /** The commit these checks ran against, so an annotation can link to the line it is about. */
  sha?: string;
  branch?: string;
  jobs: BoardJob[];
  deployments: BoardDeployment[];
};

/** Only a real workflow run has a page; a set of checks gathered under a suite does not. */
export function runUrl(repositoryUrl: string, runId?: string): string | undefined {
  if (!runId || runId.startsWith("suite-")) return undefined;

  return `${repositoryUrl}/actions/runs/${runId}`;
}

/**
 * A run's mark is the worst thing that happened in it: one failed job makes the run failed,
 * however many passed, and nothing is settled until every job has reported. A run that only
 * deployed is judged on the deployment, since `every` over no jobs is vacuously true and would
 * read as though the whole thing had been skipped.
 */
export function boardMark(jobs: BoardJob[], deployments: BoardDeployment[] = []) {
  if (
    jobs.some(({ conclusion }) => conclusion === "failure" || conclusion === "timed_out") ||
    deployments.some(({ state }) => state === "failure" || state === "error")
  )
    return marks.bad;

  if (jobs.some(({ conclusion }) => !conclusion)) return marks.active;
  if (deployments.some(({ state }) => underway.has(state))) return marks.active;

  if (jobs.length === 0)
    return deployments.some(({ state }) => state === "success") ? marks.good : marks.quiet;

  if (jobs.every(({ conclusion }) => conclusion === "skipped")) return marks.dropped;

  return marks.good;
}

/**
 * One message per workflow run, rewritten as its jobs report. A run arrives as a dozen separate
 * deliveries over several minutes; posting each one buries the channel, and none of them alone
 * answers the only question worth asking — did this run pass?
 */
export function RunBoard({
  board,
  repository,
  hook,
}: {
  board: Board;
  repository: { name: string; full_name?: string; html_url: string };
  hook?: HookScope;
}): WebhookContent {
  const { run, branch, jobs, deployments } = board;

  const rows = JobRows({ jobs, deployments, repositoryUrl: repository.html_url, sha: board.sha });
  const summary = runSummary(jobs, deployments);

  const title = run
    ? `${workflowName(run.name)} #${run.runNumber} (${triggerLabel(run.trigger)})`
    : (board.title ?? t("run.checks"));

  const ref = branch ? preferredRef(branch) : undefined;
  const url = runUrl(repository.html_url, board.runId);

  return (
    <message username="GitHub Actions" avatar_url={actionsAvatarUrl}>
      <text>
        <b>
          {lead(boardMark(jobs, deployments))}
          {url ? <a href={url}>{title}</a> : title}
          {ref ? (
            <>
              {" on "}
              <Ref repository={repository} refName={ref} hook={hook} />
            </>
          ) : (
            ""
          )}
        </b>
        {summary ? ` • ${summary}` : ""}
        {rows.length > 0 ? <br /> : ""}
        {rows}
      </text>
    </message>
  );
}

export type CommitBoardEntry = Board & { runId: string };

/**
 * Every run one commit set off, in one message: the run at the margin, everything it contains
 * stepped in beside a bar. A push and a pull request build the same commit separately and each
 * opens its own run, so they read as two rows rather than as everything happening twice.
 *
 * A run that reported nothing gets no space around it: a rule between two one-line runs
 * separates things that were never together.
 */
export function CommitBoard({
  entries,
  repository,
}: {
  entries: CommitBoardEntry[];
  repository: { name: string; full_name?: string; html_url: string };
}): WebhookContent {
  let separated = false;

  return (
    <message username="GitHub Actions" avatar_url={actionsAvatarUrl}>
      {entries.flatMap((entry) => {
        const rows = JobRows({
          jobs: entry.jobs,
          deployments: entry.deployments,
          repositoryUrl: repository.html_url,
          sha: entry.sha,
        });

        const summary = runSummary(entry.jobs, entry.deployments);
        const url = runUrl(repository.html_url, entry.runId);

        const title = entry.run
          ? `${workflowName(entry.run.name)} #${entry.run.runNumber}`
          : (entry.title ?? entry.runId);

        const spacer =
          separated && rows.length > 0 ? [<separator divider={false} spacing={1} />] : [];

        separated = separated || rows.length > 0;

        return [
          ...spacer,
          <text>
            <small>
              {lead(boardMark(entry.jobs, entry.deployments))}
              {url ? <a href={url}>{title}</a> : title}
              {summary ? ` • ${summary}` : ""}
            </small>
            {rows.length > 0 ? <br /> : ""}
            {rows}
          </text>,
        ];
      })}
    </message>
  );
}
