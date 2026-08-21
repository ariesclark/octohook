import { GithubEvent } from "../../../github";
import { HookScope } from "../../refs";

export type DeploymentStatusEvent = Extract<GithubEvent, { type: "deployment_status.created" }>;

export type DeploymentVariantProps = {
  event: DeploymentStatusEvent;
  hook?: HookScope;
};
