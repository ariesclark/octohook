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

/**
 * Faces past this stretch the chain into something that no longer reads as a huddle; who else
 * contributed is in the commit list regardless.
 */
const thumbnailAuthors = 3;

/** Rows of text the thumbnail stands as tall as, and where the narrowed column wraps. */
const sectionRows = 3;
const narrowWidth = 62;

export async function PushMessage({
  event,
  branch,
  hook,
}: PushVariantProps): Promise<WebhookContent> {
  const sender = pushSender(event);
  const identity = { username: displayUsername(sender.login), avatar_url: sender.avatar_url };

  // Ranked, so the faces that survive the cap are the ones who did the most of the work.
  const others = authorsByContribution(event.commits).filter(
    (username) => username !== sender.login,
  );

  const headline = <RefHeadline event={event} branch={branch} hook={hook} showSender={false} />;
  const showAuthor = !hasSingleAuthor(event.commits);

  const lines = event.commits.map((commit) => (
    <CommitLine commit={commit} showAuthor={showAuthor} omitAuthor={event.sender?.login} />
  ));

  // Discord puts a margin between sibling components, so joining the lines into one keeps
  // them reading as a block.
  const group = (items: string[]): string[] =>
    items.length > 0 ? [<text>{items.join("\n")}</text>] : [];

  if (others.length === 0)
    return (
      <message {...identity}>
        <text>{headline}</text>
        {group(lines)}
      </message>
    );

  const { files, url } = await avatarThumbnail(
    others.slice(0, thumbnailAuthors).map((username) => authorAvatarUrl(event, username)),
  );

  const taken = besideThumbnail(event.commits, {
    rows: sectionRows,
    width: narrowWidth,
    showAuthor,
    omitAuthor: event.sender?.login,
  });

  return (
    <message {...identity} files={files}>
      <section accessory={<thumbnail media={{ url }} />}>
        <text>{headline}</text>
        {group(lines.slice(0, taken))}
      </section>
      {group(lines.slice(taken))}
    </message>
  );
}
