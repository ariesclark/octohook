import { ButtonStyle, ComponentType } from "discord-api-types/v10";

import { toComponents } from "../../../markdown/components";
import {
  boldDeepHeadings,
  decodeEntities,
  dropComments,
  dropRules,
  formatTables,
  labelAlerts,
  leadingSection,
  limit,
  lineBreaks,
  smallText,
  taskLists,
  unredirectLinks,
} from "../../../markdown/transform";
import { Ref } from "../../components/ref";
import { HookScope } from "../../refs";
import { WebhookContent } from "../../types";
import { displayUsername } from "../push/shared";
import { pullRequestAction, pullRequestStats, PullRequestEvent } from "./shared";

/** Ordered so structure is settled before anything measures or truncates it. */
const bodyTransforms = [
  unredirectLinks,
  dropComments,
  decodeEntities,
  lineBreaks,
  smallText,
  taskLists,
  formatTables,
  boldDeepHeadings,
  labelAlerts,
  dropRules,
];

/** The body is news only while the pull request is still being proposed. */
const bodyActions = new Set(["opened", "reopened", "marked ready for review"]);

/** A backstop under an unusually long opening section; {@link leadingSection} does the cutting. */
const briefLimit = 1600;

function identity(event: PullRequestEvent) {
  const { sender } = event;

  return {
    username: displayUsername(sender?.login ?? "GitHub"),
    avatar_url: sender?.avatar_url,
  };
}

function Reference({ event }: { event: PullRequestEvent }): string {
  const { pull_request, repository } = event;

  return (
    <a href={pull_request.html_url}>
      {repository.name}#{pull_request.number}
    </a>
  );
}

/** What survived the cut, and whether anything did not — the reader needs a way to the rest. */
function briefBody(body: string | null | undefined) {
  const source = body?.replaceAll("\r", "").trim();
  if (!source) return { components: [], truncated: false };

  const printed = (components: ReturnType<typeof toComponents>) =>
    components
      .filter((component) => component.type === ComponentType.TextDisplay)
      .map((component) => (component as { content: string }).content)
      .join("").length;

  const components = toComponents(source, [...bodyTransforms, leadingSection, limit(briefLimit)]);

  return {
    components,
    truncated: printed(components) < printed(toComponents(source, bodyTransforms)),
  };
}

function Branch({
  event,
  side,
  hook,
}: {
  event: PullRequestEvent;
  side: "head" | "base";
  hook?: HookScope;
}): string {
  const { pull_request, repository } = event;

  const ref = pull_request[side]?.ref;
  if (!ref) return "";

  return (
    <Ref
      repository={pull_request[side]?.repo ?? repository}
      within={pull_request.base?.repo ?? repository}
      refName={ref}
      hook={hook}
    />
  );
}

function SeeMore({ event }: { event: PullRequestEvent }) {
  return (
    <actionrow>
      <button style={ButtonStyle.Link} url={event.pull_request.html_url} label="See more" />
    </actionrow>
  );
}

export function PullRequestMessage({
  event,
  hook,
}: {
  event: PullRequestEvent;
  hook?: HookScope;
}): WebhookContent {
  const { pull_request } = event;

  const action = pullRequestAction(event);
  const stats = pullRequestStats(pull_request);
  const base = pull_request.base?.ref;
  const head = pull_request.head?.ref;

  const open = bodyActions.has(action);
  const { components, truncated } = open
    ? briefBody(pull_request.body)
    : { components: [], truncated: false };

  return (
    <message {...identity(event)}>
      <text>
        <b>
          {open ? "wants to merge " : `${action} `}
          <Reference event={event} />
          {head ? (
            <>
              {" from "}
              <Branch event={event} side="head" hook={hook} />
            </>
          ) : (
            ""
          )}
          {base ? (
            <>
              {" into "}
              <Branch event={event} side="base" hook={hook} />
            </>
          ) : (
            ""
          )}
        </b>
        <br />
        {pull_request.title}
        {stats ? (
          <>
            <br />
            <small>{stats}</small>
          </>
        ) : (
          ""
        )}
      </text>
      {components.length > 0 ? (
        <container>
          {components}
          {truncated ? <SeeMore event={event} /> : []}
        </container>
      ) : (
        []
      )}
    </message>
  );
}
