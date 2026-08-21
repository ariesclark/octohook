import { HookScope } from "../../refs";
import { WebhookContent } from "../../types";
import { IssueNatural } from "./natural";
import { IssuesEvent } from "./shared";

export function getIssueContent(event: IssuesEvent, _hook: HookScope): WebhookContent {
  return <IssueNatural event={event} />;
}
