import { HookScope } from "../../refs";
import { WebhookContent } from "../../types";
import { PushMessage } from "./message";
import { BranchCreated, TagPushed } from "./refs";
import { PushEvent } from "./shared";

export async function getPushContent(
  event: PushEvent,
  hook: HookScope,
  origin?: string,
): Promise<WebhookContent | null> {
  const branch = event.ref.replace(/^refs\/(heads|tags)\//, "");

  // A removed ref also arrives as its own `delete` event.
  if (event.deleted) return null;

  if (event.ref.startsWith("refs/tags/"))
    return <TagPushed event={event} branch={branch} hook={hook} />;

  if (event.commits.length === 0)
    return event.created ? <BranchCreated event={event} branch={branch} hook={hook} /> : null;

  return <PushMessage event={event} branch={branch} hook={hook} origin={origin} />;
}
