import { Ref } from "../../components/ref";
import { deploymentMark, lead } from "../../marks";
import { preferredRef } from "../../refs";
import { WebhookContent } from "../../types";
import { deploymentVerb, namesRef } from "./labels";
import { DeploymentVariantProps } from "./shared";
import { t } from "../../messages.ts";

const actionsAvatarUrl = "https://avatars.githubusercontent.com/in/15368";

export function DeploymentNatural({ event, hook }: DeploymentVariantProps): WebhookContent {
  const { deployment_status, workflow_run, repository } = event;
  const { state, environment, target_url } = deployment_status;

  const url = deployment_status.environment_url || target_url;
  const branch = event.deployment?.ref ?? workflow_run?.head_branch;
  const ref = branch ? preferredRef(branch, workflow_run?.pull_requests ?? undefined) : undefined;

  return (
    <message username="GitHub Actions" avatar_url={actionsAvatarUrl}>
      <text>
        <b>
          {lead(deploymentMark(state))}
          {deploymentVerb(state)}{" "}
          {namesRef(state) ? (
            t("deploy.headline", {
              what: ref ? (
                <Ref repository={repository} refName={ref} hook={hook} />
              ) : (
                <a href={repository.html_url}>{repository.name}</a>
              ),
              where: url ? <a href={url}>{environment}</a> : environment,
            })
          ) : url ? (
            <a href={url}>{environment}</a>
          ) : (
            environment
          )}
        </b>
      </text>
    </message>
  );
}
