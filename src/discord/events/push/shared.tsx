import { GithubEvent } from "../../../github";
import { githubAvatarUrl } from "../../theme";
import { Ref } from "../../components/ref";
import { t } from "../../messages.ts";
import { HookScope } from "../../refs";

export type PushEvent = Extract<GithubEvent, { type: "push" }>;
export type PushCommit = PushEvent["commits"][number];

export type PushVariantProps = {
  event: PushEvent;
  branch: string;
  hook?: HookScope;
};

export function pushSender({ sender, pusher }: PushEvent) {
  return (
    sender ?? {
      login: pusher.name,
      html_url: `https://github.com/${pusher.username ?? pusher.name}`,
      avatar_url: githubAvatarUrl,
    }
  );
}

function pushSummary(event: PushEvent): string {
  return t("push.commits", { count: event.commits.length });
}

export function displayUsername(username: string): string {
  return username.match(/^(.+)\[bot\]$/)?.[1] ?? username;
}

/** A commit named as GitHub names it: the first seven characters, linked to itself. */
function Sha({ repositoryUrl, sha }: { repositoryUrl: string; sha: string }) {
  return (
    <a href={`${repositoryUrl}/commit/${sha}`}>
      <code>{sha.slice(0, 7)}</code>
    </a>
  );
}

export function RefHeadline({
  event,
  branch,
  hook,
  linkSender = false,
  showSender = true,
}: PushVariantProps & { linkSender?: boolean; showSender?: boolean }): string {
  const { repository, compare } = event;
  const sender = pushSender(event);

  const who = showSender ? (
    <>
      {linkSender ? (
        <a href={sender.html_url}>{displayUsername(sender.login)}</a>
      ) : (
        displayUsername(sender.login)
      )}{" "}
    </>
  ) : (
    ""
  );

  /**
   * A force-push replaces what was on the branch rather than adding to it, so there is no range
   * to show: `before` is no longer an ancestor of `after`, and the comparison GitHub draws from
   * it describes something that never happened. Both ends are named instead, which is the only
   * place the discarded commit is ever written down.
   */
  if (event.forced)
    return (
      <b>
        {who}
        {t("push.forced", {
          branch: <Ref repository={repository} refName={branch} hook={hook} />,
          before: <Sha repositoryUrl={repository.html_url} sha={event.before} />,
          after: <Sha repositoryUrl={repository.html_url} sha={event.after} />,
        })}
      </b>
    );

  return (
    <b>
      {who}
      {t("push.headline", {
        commits: <a href={compare}>{pushSummary(event)}</a>,
        branch: <Ref repository={repository} refName={branch} hook={hook} />,
      })}
    </b>
  );
}

export function authorAvatarUrl(event: PushEvent, username: string): string {
  const { sender } = event;
  if (sender?.login === username && sender.avatar_url) return sender.avatar_url;

  return `https://avatars.githubusercontent.com/${encodeURIComponent(username)}`;
}
