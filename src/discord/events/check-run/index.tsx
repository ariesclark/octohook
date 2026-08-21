import { HookScope } from "../../refs";
import { WebhookContent } from "../../types";
import { CheckRunMessage } from "./message";
import { CheckRunEvent } from "./shared";

export function getCheckRunContent(event: CheckRunEvent, hook: HookScope): WebhookContent | null {
  if (event.check_run.status !== "completed") return null;

  return <CheckRunMessage event={event} hook={hook} />;
}
