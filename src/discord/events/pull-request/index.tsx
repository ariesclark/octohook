import { HookScope } from "../../refs";
import { WebhookContent } from "../../types";
import { PullRequestMessage } from "./message";
import { PullRequestEvent } from "./shared";

export function getPullRequestContent(event: PullRequestEvent, hook: HookScope): WebhookContent {
  return <PullRequestMessage event={event} hook={hook} />;
}
