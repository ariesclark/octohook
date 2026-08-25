import { t } from "../../messages.ts";
import { avatarThumbnail } from "../../components/avatar";
import { WebhookContent } from "../../types";
import { besideThumbnail, CommitLine, hasSingleAuthor } from "./commits";
import { authorsByContribution } from "./contribution";
import {
  authorAvatarUrl,
  displayUsername,
  pushSender,
  PushVariantProps,
  RefHeadline,
} from "./shared";

const thumbnailAuthors = 3;

/** GitHub sends every commit a push carried, and Discord takes 4000 characters in one line. */
const mostCommits = 10;

const sectionRows = 3;
const narrowWidth = 62;

export async function PushMessage({
  event,
  branch,
  hook,
  origin,
}: PushVariantProps & { origin?: string }): Promise<WebhookContent> {
  const sender = pushSender(event);
  const identity = { username: displayUsername(sender.login), avatar_url: sender.avatar_url };

  const others = authorsByContribution(event.commits).filter(
    (username) => username !== sender.login,
  );

  const headline = <RefHeadline event={event} branch={branch} hook={hook} showSender={false} />;
  const showAuthor = !hasSingleAuthor(event.commits);

  const listed = event.commits.slice(0, mostCommits);
  const rest = event.commits.length - listed.length;

  const lines = [
    ...listed.map((commit) => (
      <CommitLine commit={commit} showAuthor={showAuthor} omitAuthor={event.sender?.login} />
    )),
    ...(rest > 0 ? [<small>{t("push.more", { count: rest })}</small>] : []),
  ];

  // Discord puts a margin between sibling components.
  const group = (items: string[]): string[] =>
    items.length > 0 ? [<text>{items.join("\n")}</text>] : [];

  if (others.length === 0)
    return (
      <message {...identity}>
        <text>{headline}</text>
        {group(lines)}
      </message>
    );

  const { url } = avatarThumbnail(
    others.slice(0, thumbnailAuthors).map((username) => authorAvatarUrl(event, username)),
    origin,
  );

  const taken = besideThumbnail(event.commits, {
    rows: sectionRows,
    width: narrowWidth,
    showAuthor,
    omitAuthor: event.sender?.login,
  });

  return (
    <message {...identity}>
      <section accessory={<thumbnail media={{ url }} />}>
        <text>{headline}</text>
        {group(lines.slice(0, taken))}
      </section>
      {group(lines.slice(taken))}
    </message>
  );
}
