import { Ref } from "../../components/ref";
import { lead } from "../../marks";
import { t } from "../../messages.ts";
import { HookScope, preferredRef } from "../../refs";
import { WebhookContent } from "../../types";
import {
  runConclusionLabel,
  runConclusionMark,
  runDuration,
  workflowName,
  WorkflowRunEvent,
} from "./shared";

// GitHub Actions app id, so scheduled runs post under one recognisable identity.
const actionsAvatarUrl = "https://avatars.githubusercontent.com/in/15368";

export function WorkflowRunNatural({
  event,
  hook,
}: {
  event: WorkflowRunEvent;
  hook?: HookScope;
}): WebhookContent {
  const { workflow_run, repository } = event;
  const { name, html_url, conclusion, head_branch, run_number, run_started_at, updated_at } =
    workflow_run;

  const duration = runDuration(run_started_at, updated_at);
  const ref = head_branch
    ? preferredRef(head_branch, workflow_run.pull_requests ?? undefined)
    : undefined;

  // Reads as a check run does — what ran, how it went, where — since they report the same thing
  // at different grain.
  return (
    <message username="GitHub Actions" avatar_url={actionsAvatarUrl}>
      <text>
        <b>
          {lead(runConclusionMark(conclusion))}
          {t(ref ? "run.headline" : "run.settled", {
            run: (
              <a href={html_url}>
                {workflowName(name ?? "")}
                {run_number ? ` #${run_number}` : ""}
              </a>
            ),
            verdict: runConclusionLabel(conclusion),
            ref: ref ? <Ref repository={repository} refName={ref} hook={hook} /> : "",
          })}
        </b>
        {duration ? ` ${t("check.took", { duration })}` : ""}
      </text>
    </message>
  );
}
