import { toComponents } from "../../../markdown/components";
import {
  boldDeepHeadings,
  decodeEntities,
  dropComments,
  dropRules,
  formatTables,
  htmlLinks,
  labelAlerts,
  leadingSection,
  limit,
  lineBreaks,
  quoted,
  smallText,
  taskLists,
  unredirectLinks,
} from "../../../markdown/transform";
import { t } from "../../messages.ts";
import { HookScope } from "../../refs";
import { WebhookContent } from "../../types";
import { displayUsername } from "../push/shared";
import { commentLocation, diffBlock, hunkAround, ReviewCommentEvent } from "./shared";

const bodyTransforms = [
  unredirectLinks,
  dropComments,
  decodeEntities,
  lineBreaks,
  smallText,
  taskLists,
  formatTables,
  boldDeepHeadings,
  htmlLinks,
  labelAlerts,
  dropRules,
];

const briefLimit = 1200;

export function ReviewCommentMessage({
  event,
}: {
  event: ReviewCommentEvent;
  hook?: HookScope;
}): WebhookContent {
  const { comment, sender } = event;

  const location = commentLocation(comment);
  const hunk = comment.diff_hunk ? hunkAround(comment.diff_hunk, comment) : undefined;

  const body = comment.body?.replaceAll("\r", "").trim();
  const components = body
    ? toComponents(body, [...bodyTransforms, leadingSection, limit(briefLimit), quoted])
    : [];

  return (
    <message username={displayUsername(sender?.login ?? "GitHub")} avatar_url={sender?.avatar_url}>
      <text>
        <b>
          {t("review.comment", {
            location: location ? <a href={comment.html_url}>{location}</a> : "",
          })}
        </b>
      </text>
      {hunk || components.length > 0 ? (
        <container>
          {hunk ? <text>{diffBlock(hunk)}</text> : []}
          {components}
        </container>
      ) : (
        []
      )}
    </message>
  );
}
