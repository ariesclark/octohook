import { Brief } from "../body";
import { t, type Phrase } from "../../messages.ts";
import { WebhookContent } from "../../types";
import { displayUsername } from "../push/shared";
import { issueLabels, IssuesEvent } from "./shared";

const headlines: Partial<Record<string, Phrase>> = {
  opened: "issue.opened",
  closed: "issue.closed",
  reopened: "issue.reopened",
};

/**
 * An issue is read when it is opened, so that message carries what it is called and what it says.
 * Every other message is about a change of state, and the title has already been said above it.
 */
const readActions = new Set(["opened"]);

export function IssueNatural({ event }: { event: IssuesEvent }): WebhookContent {
  const { issue, repository, sender, action } = event;

  const closedAsNotPlanned = action === "closed" && issue.state_reason === "not_planned";
  const open = readActions.has(action);

  const labels = open ? issueLabels(issue.labels) : undefined;

  return (
    <message username={displayUsername(sender.login)} avatar_url={sender.avatar_url}>
      <text>
        <b>
          {t(closedAsNotPlanned ? "issue.not_planned" : (headlines[action] ?? "issue.other"), {
            action,
            issue: (
              <a href={issue.html_url}>
                {repository.name}#{issue.number}
              </a>
            ),
          })}
        </b>
      </text>
      {!open ? (
        []
      ) : (
        <Brief title={issue.title} body={issue.body} url={issue.html_url}>
          {labels ? (
            <text>
              <small>{t("issue.labels", { labels })}</small>
            </text>
          ) : (
            []
          )}
        </Brief>
      )}
    </message>
  );
}
