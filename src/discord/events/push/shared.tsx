import { GithubEvent } from "../../../github";
import { githubAvatarUrl } from "../../theme";
import { Ref } from "../../components/ref";
import { RepositoryName } from "../../components/repository-name";
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

export function pushSummary(event: PushEvent): string {
  const count = event.commits.length;
  return `${count} new ${count === 1 ? "commit" : "commits"}`;
}

export function PushHeadline({ event, branch }: PushVariantProps): string {
  const { repository, compare } = event;
  const sender = pushSender(event);

  return (
    <b>
      <RepositoryName repository={repository} /> {sender.login} pushed{" "}
      <a href={compare}>{pushSummary(event)}</a> to <code>{branch}</code>
    </b>
  );
}

export function pushTimestamp(event: PushEvent): string | Date | undefined {
  const head = event.head_commit?.timestamp;
  if (head) return head;

  // `repository.pushed_at` is epoch seconds on push payloads, not milliseconds.
  const pushed = event.repository.pushed_at;
  if (typeof pushed === "number") return new Date(pushed * 1000);

  return pushed ?? undefined;
}

export function displayUsername(username: string): string {
  return username.match(/^(.+)\[bot\]$/)?.[1] ?? username;
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

  return (
    <b>
      {showSender ? (
        <>
          {linkSender ? (
            <a href={sender.html_url}>{displayUsername(sender.login)}</a>
          ) : (
            displayUsername(sender.login)
          )}{" "}
        </>
      ) : (
        ""
      )}
      pushed <a href={compare}>{pushSummary(event)}</a> to{" "}
      <Ref repository={repository} refName={branch} hook={hook} />
    </b>
  );
}

export function authorAvatarUrl(event: PushEvent, username: string): string {
  const { sender } = event;
  if (sender?.login === username && sender.avatar_url) return sender.avatar_url;

  return `https://avatars.githubusercontent.com/${encodeURIComponent(username)}`;
}
