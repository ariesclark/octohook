import { Ref } from "../../components/ref";
import { lead, marks } from "../../marks";
import { t } from "../../messages.ts";
import { WebhookContent } from "../../types";
import { displayUsername, PushEvent, pushSender, PushVariantProps } from "./shared";

function RefMessage({ event, children }: { event: PushEvent; children?: unknown }): WebhookContent {
  const sender = pushSender(event);

  return (
    <message username={displayUsername(sender.login)} avatar_url={sender.avatar_url}>
      <text>{children}</text>
    </message>
  );
}

/**
 * A branch made from a commit that already exists arrives as a push with nothing in it, and
 * GitHub's own `create` event is dropped because it duplicates every other branch push. Without
 * this the branch appears from nowhere.
 */
export function BranchCreated({ event, branch, hook }: PushVariantProps): WebhookContent {
  return (
    <RefMessage event={event}>
      <b>
        {lead(marks.quiet)}
        {t("push.branch", {
          branch: <Ref repository={event.repository} refName={branch} hook={hook} />,
        })}
      </b>
    </RefMessage>
  );
}

export function TagPushed({ event, branch, hook }: PushVariantProps): WebhookContent {
  return (
    <RefMessage event={event}>
      <b>
        {lead(marks.quiet)}
        {t("push.tag", {
          tag: <Ref repository={event.repository} refName={`refs/tags/${branch}`} hook={hook} />,
        })}
      </b>
    </RefMessage>
  );
}
