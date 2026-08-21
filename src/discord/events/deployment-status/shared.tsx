import { GithubEvent } from "../../../github";
import { HookScope } from "../../refs";

export type DeploymentStatusEvent = Extract<GithubEvent, { type: "deployment_status.created" }>;

export type DeploymentVariantProps = {
  event: DeploymentStatusEvent;
  hook?: HookScope;
};

const deploymentStateLabels: Partial<Record<string, string>> = {
  success: "succeeded",
  failure: "failed",
  error: "errored",
  in_progress: "in progress",
};

export function deploymentStateLabel(state: string): string {
  return deploymentStateLabels[state] ?? state;
}

export function WorkflowLine({
  workflow_run,
  repository,
}: Pick<DeploymentStatusEvent, "workflow_run" | "repository">): string {
  return workflow_run ? (
    <>
      <a href={workflow_run.html_url}>
        <code>{workflow_run.name}</code>
      </a>{" "}
      {workflow_run.display_title}
    </>
  ) : (
    <a href={repository.html_url}>{repository.full_name}</a>
  );
}
