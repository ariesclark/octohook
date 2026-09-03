import { ButtonStyle } from "discord-api-types/v10";

import { Ref } from "../../components/ref";
import { checkMark, lead, marks } from "../../marks";
import { t } from "../../messages.ts";
import { HookScope, preferredRef } from "../../refs";
import { WebhookContent } from "../../types";
import { triggerLabel, workflowName } from "../workflow-run/shared";
import { JobRows, runSummary, underway, type BoardDeployment, type BoardJob } from "./rows";
import { ResolvedRun } from "./run";

const actionsAvatarUrl = "https://avatars.githubusercontent.com/in/15368";

export type { BoardJob };

export type { BoardDeployment };

export type Board = {
  run?: ResolvedRun;
  settled?: string | null;
  startedAt?: string;
  completedAt?: string;
  runId?: string;
  title?: string;
  sha?: string;
  branch?: string;
  jobs: BoardJob[];
  deployments: BoardDeployment[];
};

function runUrl(repositoryUrl: string, runId?: string): string | undefined {
  if (!runId || runId.startsWith("suite-")) return undefined;

  return `${repositoryUrl}/actions/runs/${runId}`;
}

export function boardMark(
  jobs: BoardJob[],
  deployments: BoardDeployment[] = [],
  settled?: string | null,
) {
  if (
    jobs.some(({ conclusion }) => conclusion === "failure" || conclusion === "timed_out") ||
    deployments.some(({ state }) => state === "failure" || state === "error")
  )
    return marks.bad;

  if (jobs.some(({ conclusion }) => !conclusion)) return marks.quiet;
  if (deployments.some(({ state }) => underway.has(state))) return marks.quiet;

  if (jobs.length === 0) {
    if (deployments.some(({ state }) => state === "success")) return marks.good;

    return settled ? checkMark(settled) : marks.quiet;
  }

  if (jobs.every(({ conclusion }) => conclusion === "skipped")) return marks.dropped;

  return marks.good;
}

/** A run held for approval is acted on in one place, so the board carries the way there. */
function held(settled: string | null | undefined, url: string | undefined) {
  if (settled !== "action_required" || !url) return undefined;

  return <button style={ButtonStyle.Link} url={url} label={t("run.approve")} />;
}

export function RunBoard({
  board,
  repository,
  hook,
}: {
  board: Board;
  repository: { name: string; full_name?: string; html_url: string };
  hook?: HookScope;
}): WebhookContent {
  const { run, branch, jobs, deployments, settled, startedAt, completedAt } = board;

  const rows = JobRows({ jobs, deployments, repositoryUrl: repository.html_url, sha: board.sha });
  const summary = runSummary(jobs, deployments, { startedAt, completedAt }, settled);

  const title = run
    ? `${workflowName(run.name)} #${run.runNumber} (${triggerLabel(run.trigger)})`
    : (board.title ?? t("run.checks"));

  const ref = branch ? preferredRef(branch) : undefined;
  const url = runUrl(repository.html_url, board.runId);
  const approve = held(settled, url);

  const headline = (
    <>
      {"-# "}
      {lead(boardMark(jobs, deployments, settled))}
      <b>{url ? <a href={url}>{title}</a> : title}</b>
      {ref ? (
        <>
          {" on "}
          <Ref repository={repository} refName={ref} hook={hook} />
        </>
      ) : (
        ""
      )}
      {summary ? ` • ${summary}` : ""}
    </>
  );

  return (
    <message username="GitHub Actions" avatar_url={actionsAvatarUrl}>
      {approve ? (
        <section accessory={approve}>
          <text>{headline}</text>
          {rows.length > 0 ? <text>{rows}</text> : []}
        </section>
      ) : (
        <text>
          {headline}
          {rows.length > 0 ? <br /> : ""}
          {rows}
        </text>
      )}
    </message>
  );
}

export type CommitBoardEntry = Board & { runId: string };

export function CommitBoard({
  entries,
  repository,
}: {
  entries: CommitBoardEntry[];
  repository: { name: string; full_name?: string; html_url: string };
}): WebhookContent {
  return (
    <message username="GitHub Actions" avatar_url={actionsAvatarUrl}>
      {entries.flatMap((entry) => {
        const rows = JobRows({
          jobs: entry.jobs,
          deployments: entry.deployments,
          repositoryUrl: repository.html_url,
          sha: entry.sha,
        });

        const summary = runSummary(entry.jobs, entry.deployments, entry, entry.settled);
        const url = runUrl(repository.html_url, entry.runId);

        const title = entry.run
          ? `${workflowName(entry.run.name)} #${entry.run.runNumber}`
          : (entry.title ?? t("run.checks"));

        const approve = held(entry.settled, url);

        const headline = (
          <>
            {"-# "}
            {lead(boardMark(entry.jobs, entry.deployments, entry.settled))}
            <b>{url ? <a href={url}>{title}</a> : title}</b>
            {summary ? ` • ${summary}` : ""}
          </>
        );

        return [
          approve ? (
            <section accessory={approve}>
              <text>{headline}</text>
              {rows.length > 0 ? <text>{rows}</text> : []}
            </section>
          ) : (
            <text>
              {headline}
              {rows.length > 0 ? <br /> : ""}
              {rows}
            </text>
          ),
        ];
      })}
    </message>
  );
}
