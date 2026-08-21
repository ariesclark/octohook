import { issueMark, lead } from "../../marks";
import { t, type Phrase } from "../../messages.ts";
import { WebhookContent } from "../../types";
import { displayUsername } from "../push/shared";
import { excerpt, issueLabels, IssuesEvent } from "./shared";

/**
 * One phrase per action this is routed for. GitHub adds actions without warning, and one the
 * catalogue has no sentence for keeps its own word rather than being given wording it never had.
 */
const headlines: Partial<Record<string, Phrase>> = {
  opened: "issue.opened",
  closed: "issue.closed",
  reopened: "issue.reopened",
};

export function IssueNatural({ event }: { event: IssuesEvent }): WebhookContent {
  const { issue, repository, sender, action } = event;

  const summary = excerpt(issue.body);
  const labels = issueLabels(issue.labels);
  const closedAsNotPlanned = action === "closed" && issue.state_reason === "not_planned";

  return (
    <message username={displayUsername(sender.login)} avatar_url={sender.avatar_url}>
      <text>
        <b>
          {lead(issueMark(action, issue.state_reason))}
          {t(closedAsNotPlanned ? "issue.not_planned" : (headlines[action] ?? "issue.other"), {
            action,
            issue: (
              <a href={issue.html_url}>
                {repository.name}#{issue.number}
              </a>
            ),
            title: issue.title,
          })}
        </b>
        {summary || labels ? (
          <>
            <br />
            <small>
              {summary ?? ""}
              {summary && labels ? " • " : ""}
              {labels ? t("issue.labels", { labels }) : ""}
            </small>
          </>
        ) : (
          ""
        )}
      </text>
    </message>
  );
}
