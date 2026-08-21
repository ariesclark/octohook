import { HookScope } from "../../refs";
import { WebhookContent } from "../../types";
import { WorkflowRunNatural } from "./natural";
import { WorkflowRunEvent } from "./shared";

export function getWorkflowRunContent(event: WorkflowRunEvent, hook: HookScope): WebhookContent {
  return <WorkflowRunNatural event={event} hook={hook} />;
}
