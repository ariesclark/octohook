import { Brief } from "../body";
import { Ref } from "../../components/ref";
import { t, type Phrase } from "../../messages.ts";
import { HookScope, pullRef } from "../../refs";
import { WebhookContent } from "../../types";
import { displayUsername } from "../push/shared";
import { PullRequestReviewEvent, reviewVerdict } from "./shared";

const headlines: Partial<Record<string, Phrase>> = {
  approved: "review.approved",
  changes_requested: "review.changes_requested",
  commented: "review.commented",
};

export function PullRequestReviewMessage({
  event,
  hook,
}: {
  event: PullRequestReviewEvent;
  hook?: HookScope;
}): WebhookContent {
  const { pull_request, repository, review, sender } = event;

  const verdict = reviewVerdict(event);
  const within = pull_request.base?.repo ?? repository;

  return (
    <message username={displayUsername(sender?.login ?? "GitHub")} avatar_url={sender?.avatar_url}>
      <text>
        <b>
          {t(headlines[verdict] ?? "review.commented", {
            reference: (
              <Ref
                repository={within}
                within={within}
                refName={pullRef(pull_request.number)}
                hook={hook}
              />
            ),
          })}
        </b>
      </text>
      <Brief
        body={(review as { body?: string | null }).body}
        url={(review as { html_url: string }).html_url}
      />
    </message>
  );
}
