import { HookScope } from "../../refs";
import { WebhookContent } from "../../types";
import { ReviewCommentMessage } from "./message";
import { ReviewCommentEvent } from "./shared";

export function getReviewCommentContent(
  event: ReviewCommentEvent,
  hook: HookScope,
): WebhookContent {
  return <ReviewCommentMessage event={event} hook={hook} />;
}
