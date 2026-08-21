import { HookScope } from "../../refs";
import { WebhookContent } from "../../types";
import { DeploymentNatural } from "./natural";
import { DeploymentStatusEvent } from "./shared";

export function getDeploymentStatusContent(
  event: DeploymentStatusEvent,
  hook: HookScope,
): WebhookContent {
  return <DeploymentNatural event={event} hook={hook} />;
}
