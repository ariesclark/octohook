import { GithubEvent } from "../../../github";
import { Ref } from "../../components/ref";
import { lead, marks } from "../../marks";
import { t } from "../../messages.ts";
import { HookScope } from "../../refs";
import { WebhookContent } from "../../types";
import { displayUsername } from "../push/shared";

export type DeleteEvent = Extract<GithubEvent, { type: "delete" }>;

/** GitHub announces a removed branch twice: as this, and as a push whose `after` is all zeroes. */
export function getDeleteContent(event: DeleteEvent, hook: HookScope): WebhookContent {
  const { ref, ref_type: type, repository, sender } = event;

  return (
    <message username={displayUsername(sender.login)} avatar_url={sender.avatar_url}>
      <text>
        <b>
          {lead(marks.dropped)}
          {t(type === "tag" ? "delete.tag" : "delete.branch", {
            ref: <Ref repository={repository} refName={ref} hook={hook} />,
          })}
        </b>
      </text>
    </message>
  );
}
