import { issueMark, lead } from "../../marks";
import { WebhookContent } from "../../types";
import { displayUsername } from "../push/shared";
import { excerpt, issueLabels, IssuesEvent } from "./shared";

const actionLabels: Partial<Record<string, string>> = {
  opened: "opened",
  closed: "closed",
  reopened: "reopened",
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
          {actionLabels[action] ?? action}
          {closedAsNotPlanned ? " as not planned" : ""} issue{" "}
          <a href={issue.html_url}>
            {repository.name}#{issue.number}
          </a>
          : {issue.title}
        </b>
        {summary || labels ? (
          <>
            <br />
            <small>
              {summary ?? ""}
              {summary && labels ? " • " : ""}
              {labels ? `labels: ${labels}` : ""}
            </small>
          </>
        ) : (
          ""
        )}
      </text>
    </message>
  );
}
