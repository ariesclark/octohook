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
import { getPullRequestReviewContent } from "./events/pull-request-review";
import { getStarContent } from "./events/star";
import { getVulnerabilityAlertContent } from "./events/vulnerability-alert";
import { getDeleteContent } from "./events/delete";

export type { WebhookContent, WebhookFile } from "./types";

export async function getWebhookRequest(
  secret: string,
  event: GithubEvent,
  hook: HookScope = "repository",
  origin?: string,
): Promise<Request | null> {
  const content = await getWebhookContent(event, hook, origin);
  if (!content) return null;

  return toRequest(secret, { ...defaultWebhookContent, ...content });
}

async function getWebhookContent(
  event: GithubEvent,
  hook: HookScope,
  origin?: string,
): Promise<WebhookContent | null> {
  switch (event.type) {
    case "push":
      return getPushContent(event, hook, origin);

    case "deployment_status.created":
      return getDeploymentStatusContent(event, hook);

    case "check_run.completed":
      return getCheckRunContent(event, hook);

    case "issues.opened":
    case "issues.closed":
    case "issues.reopened":
      return getIssueContent(event, hook);

    // `watch.started` duplicates `star.created`.
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

    case "pull_request_review.submitted":
      return getPullRequestReviewContent(event, hook);

    // Every other message carries the title, so only a retarget is worth saying.
    case "pull_request.edited":
      return event.changes?.base ? getPullRequestContent(event, hook) : null;

    case "delete":
      return getDeleteContent(event, hook);
  }

  return null;
}
