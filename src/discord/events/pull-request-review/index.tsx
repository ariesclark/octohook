import { HookScope } from "../../refs";
import { WebhookContent } from "../../types";
import { PullRequestReviewMessage } from "./message";
import { PullRequestReviewEvent } from "./shared";

export function getPullRequestReviewContent(
  event: PullRequestReviewEvent,
  hook: HookScope,
): WebhookContent {
  return <PullRequestReviewMessage event={event} hook={hook} />;
}
