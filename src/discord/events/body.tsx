import { ButtonStyle, ComponentType } from "discord-api-types/v10";

import { toComponents } from "../../markdown/components";
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
  smallText,
  taskLists,
  unredirectLinks,
} from "../../markdown/transform";
import { t } from "../messages.ts";

const transforms = [
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

const briefLimit = 1600;

/**
 * What is worth reading in a channel: the leading section, cut to a length nobody scrolls past,
 * and whether anything was left behind.
 */
export function briefBody(body: string | null | undefined) {
  const source = body?.replaceAll("\r", "").trim();
  if (!source) return { components: [], truncated: false };

  const printed = (components: ReturnType<typeof toComponents>) =>
    components
      .filter((component) => component.type === ComponentType.TextDisplay)
      .map((component) => (component as { content: string }).content)
      .join("").length;

  const components = toComponents(source, [...transforms, leadingSection, limit(briefLimit)]);

  return {
    components,
    truncated: printed(components) < printed(toComponents(source, transforms)),
  };
}

export function SeeMore({ url }: { url: string }) {
  return (
    <actionrow>
      <button style={ButtonStyle.Link} url={url} label={t("pull.more")} />
    </actionrow>
  );
}

/**
 * What a thing is called and what it says, which is read once: when a pull request goes up, when an
 * issue is opened, when a review lands. Anything else belongs beneath it, as `children`.
 */
export function Brief({
  title,
  body,
  url,
  children,
}: {
  title?: string;
  body: string | null | undefined;
  url: string;
  children?: unknown;
}) {
  const { components, truncated } = briefBody(body);

  // A container holding nothing at all is refused, and untitled silence is nothing to draw.
  if (!title && components.length === 0) return [];

  return (
    <container>
      {title ? (
        <text>
          <h3>{title}</h3>
        </text>
      ) : (
        []
      )}
      {title && components.length > 0 ? <separator divider={false} /> : []}
      {components}
      {children ?? []}
      {truncated ? <SeeMore url={url} /> : []}
    </container>
  );
}
