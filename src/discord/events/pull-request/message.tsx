import { briefBody, SeeMore } from "../body";
import { Ref } from "../../components/ref";
import { t, type Phrase } from "../../messages.ts";
import { HookScope, pullRef } from "../../refs";
import { WebhookContent } from "../../types";
import { displayUsername, Sha } from "../push/shared";
import { pullRequestAction, pullRequestChanges, PullRequestEvent } from "./shared";

/**
 * A pull request is read when it is put up for review, so those two messages carry what it is
 * called and what it says. Every other message is about a change of state, and the title has
 * already been said above it.
 */
const readActions = new Set(["opened", "marked ready for review"]);

function identity(event: PullRequestEvent) {
  const { sender } = event;

  return {
    username: displayUsername(sender?.login ?? "GitHub"),
    avatar_url: sender?.avatar_url,
  };
}

function Reference({ event, hook }: { event: PullRequestEvent; hook?: HookScope }): string {
  const { pull_request, repository } = event;
  const within = pull_request.base?.repo ?? repository;

  return (
    <Ref repository={within} within={within} refName={pullRef(pull_request.number)} hook={hook} />
  );
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
      established
    />
  );
}

function PreviousBase({
  event,
  ref,
  hook,
}: {
  event: PullRequestEvent;
  ref: string;
  hook?: HookScope;
}): string {
  const { pull_request, repository } = event;

  return (
    <Ref
      repository={pull_request.base?.repo ?? repository}
      within={pull_request.base?.repo ?? repository}
      refName={ref}
      hook={hook}
      established
    />
  );
}

const headlines: Partial<Record<string, Phrase>> = {
  opened: "pull.opened",
  reopened: "pull.reopened",
  merged: "pull.merged",
  enqueued: "pull.enqueued",
  dequeued: "pull.dequeued",
  closed: "pull.closed",
  updated: "pull.updated",
  retargeted: "pull.retargeted",
  "marked ready for review": "pull.ready",
  "converted to draft": "pull.draft",
};

export function PullRequestMessage({
  event,
  hook,
}: {
  event: PullRequestEvent;
  hook?: HookScope;
}): WebhookContent {
  const { pull_request } = event;

  const action = pullRequestAction(event);
  const changes = pullRequestChanges(event);
  const base = pull_request.base?.ref;
  const head = pull_request.head?.ref;
  const previous = changes?.base?.ref?.from;
  const after = (event as { after?: string }).after;

  const elsewhere =
    Boolean(pull_request.head?.repo?.full_name) &&
    pull_request.head?.repo?.full_name !== (pull_request.base?.repo ?? event.repository).full_name;

  const phrase =
    action === "updated" && !after
      ? "pull.moved"
      : action === "updated" && elsewhere
        ? "pull.updated_elsewhere"
        : (headlines[action] ?? "pull.other");

  const open = readActions.has(action);
  const { components, truncated } = open
    ? briefBody(pull_request.body)
    : { components: [], truncated: false };

  const headline = (
    <text>
      <b>
        {t(phrase, {
          action,
          reference: <Reference event={event} hook={hook} />,
          head: head ? <Branch event={event} side="head" hook={hook} /> : "",
          base: base ? <Branch event={event} side="base" hook={hook} /> : "",
          previous: previous ? <PreviousBase event={event} ref={previous} hook={hook} /> : "",
          sha: after ? (
            <Sha
              repositoryUrl={(pull_request.head?.repo ?? event.repository).html_url}
              sha={after}
            />
          ) : (
            ""
          ),
        })}
      </b>
    </text>
  );

  return (
    <message {...identity(event)}>
      {headline}
      {!readActions.has(action) ? (
        []
      ) : (
        <container>
          <text>
            <h3>{pull_request.title}</h3>
          </text>
          {components.length > 0 ? <separator divider={false} /> : []}
          {components}
          {truncated ? <SeeMore url={pull_request.html_url} /> : []}
        </container>
      )}
    </message>
  );
}
