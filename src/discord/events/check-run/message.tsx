import { WebhookContent } from "../../types";
import { Ref } from "../../components/ref";
import { checkMark, lead } from "../../marks";
import { t } from "../../messages.ts";
import { HookScope, preferredRef } from "../../refs";
import { appAvatarUrl, CheckRunEvent, checkDuration, conclusionLabel } from "./shared";

export function CheckRunMessage({
  event,
  hook,
}: {
  event: CheckRunEvent;
  hook?: HookScope;
}): WebhookContent {
  const { check_run, repository } = event;
  const { name, html_url, conclusion, started_at, completed_at, check_suite, app } = check_run;

  const head = check_suite?.head_branch;
  const branch = head ? preferredRef(head, check_run.pull_requests ?? undefined) : undefined;
  const duration = checkDuration(started_at, completed_at);

  return (
    <message username={app?.name ?? "GitHub"} avatar_url={appAvatarUrl(app)}>
      <text>
        <b>
          {lead(checkMark(conclusion))}
          {t("check.headline", {
            check: <a href={html_url}>{name}</a>,
            verdict: conclusionLabel(conclusion),
            where: branch ? (
              <Ref repository={repository} refName={branch} hook={hook} />
            ) : (
              <a href={repository.html_url}>{repository.name}</a>
            ),
          })}
        </b>
        {duration ? ` ${t("check.took", { duration })}` : ""}
      </text>
    </message>
  );
}
