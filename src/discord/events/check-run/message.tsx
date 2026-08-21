import { WebhookContent } from "../../types";
import { Ref } from "../../components/ref";
import { checkMark, lead } from "../../marks";
import { HookScope, preferredRef } from "../../refs";
import { appAvatarUrl, CheckRunEvent, checkDuration, conclusionLabel } from "./shared";

/**
 * {@link CheckRunMarksInlinePlain} without the commit line. A check run rarely arrives alone,
 * and the commit is the one thing every one of them repeats.
 */
/** One line per check: the mark carries the outcome, the duration rides in the sentence. */
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
          <a href={html_url}>{name}</a> {conclusionLabel(conclusion)}
          {branch ? (
            <>
              {" on "}
              <Ref repository={repository} refName={branch} hook={hook} />
            </>
          ) : (
            <>
              {" on "}
              <a href={repository.html_url}>{repository.name}</a>
            </>
          )}
        </b>
        {duration ? ` in ${duration}` : ""}
      </text>
    </message>
  );
}
