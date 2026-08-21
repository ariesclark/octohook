import { GithubEvent } from "../github";
import { HookScope } from "./refs";
import { defaultWebhookContent } from "./theme";
import { toRequest } from "./request";
import { WebhookContent } from "./types";
import { getPushContent } from "./events/push";
import { getDeploymentStatusContent } from "./events/deployment-status";
import { getCheckRunContent } from "./events/check-run";
import { getIssueContent } from "./events/issues";
import { getPullRequestContent } from "./events/pull-request";
import { getWorkflowRunContent } from "./events/workflow-run";
import { getStarContent } from "./events/star";
import { getVulnerabilityAlertContent } from "./events/vulnerability-alert";
import { getDeleteContent } from "./events/delete";

export type { WebhookContent, WebhookFile } from "./types";

/** `null` drops the event: anything without a renderer below is intentionally not posted. */
export async function getWebhookRequest(
  secret: string,
  event: GithubEvent,
  hook: HookScope = "repository",
): Promise<Request | null> {
  const content = await getWebhookContent(event, hook);
  if (!content) return null;

  return toRequest(secret, { ...defaultWebhookContent, ...content });
}

async function getWebhookContent(
  event: GithubEvent,
  hook: HookScope,
): Promise<WebhookContent | null> {
  switch (event.type) {
    case "push":
      return getPushContent(event, hook);

    case "deployment_status.created":
      return getDeploymentStatusContent(event, hook);

    // check_run.created / .rerequested / .requested_action are progress noise.
    case "check_run.completed":
      return getCheckRunContent(event, hook);

    // issues.edited and the label/assign/pin actions are noise.
    case "issues.opened":
    case "issues.closed":
    case "issues.reopened":
      return getIssueContent(event, hook);

    // workflow_job and the requested/in_progress runs are progress noise.
    case "workflow_run.completed":
      return getWorkflowRunContent(event, hook);

    // `watch.started` duplicates `star.created`, so only stars are posted.
    case "star.created":
    case "star.deleted":
      return getStarContent(event, hook);

    case "repository_vulnerability_alert.create":
    case "repository_vulnerability_alert.resolve":
    case "repository_vulnerability_alert.dismiss":
      return getVulnerabilityAlertContent(event, hook);

    case "pull_request.opened":
    case "pull_request.closed":
    case "pull_request.reopened":
    case "pull_request.ready_for_review":
    case "pull_request.synchronize":
      return getPullRequestContent(event, hook);

    // Renovate rewrites a body on every rebase; only a rename or a new target is news.
    case "pull_request.edited":
      return event.changes?.title || event.changes?.base
        ? getPullRequestContent(event, hook)
        : null;

    case "delete":
      return getDeleteContent(event, hook);
  }

  return null;
}
