import { GithubEvent } from "../../../github";
import { t } from "../../messages.ts";
import { HookScope } from "../../refs";
import { WebhookContent } from "../../types";
import { displayUsername } from "../push/shared";

export type StarEvent = Extract<GithubEvent, { type: `star.${string}` }>;

export function getStarContent(event: StarEvent, _hook: HookScope): WebhookContent {
  const { repository, sender, action } = event;
  const stars = repository.stargazers_count;

  return (
    <message username={displayUsername(sender.login)} avatar_url={sender.avatar_url}>
      <text>
        <b>
          {t(action === "deleted" ? "star.removed" : "star.added", {
            repository: <a href={repository.html_url}>{repository.name}</a>,
          })}
        </b>
        {stars ? (
          <>
            <br />
            <small>{t("star.count", { count: stars })}</small>
          </>
        ) : (
          ""
        )}
      </text>
    </message>
  );
}
