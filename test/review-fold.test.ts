import { describe, expect, it } from "vitest";

import { compose } from "../src/compose";
import { getWebhookRequest } from "../src/discord";
import { getReviewCommentContent } from "../src/discord/events/pull-request-review-comment";
import type { GithubEvent } from "../src/github";
import { apply, emptyWorld, type World } from "../src/state";

const repository = {
  name: "wiki-bot",
  full_name: "vrchatapi/wiki-bot",
  html_url: "https://github.com/vrchatapi/wiki-bot",
};

const sender = { login: "Copilot", avatar_url: "https://avatars.githubusercontent.com/u/3" };

const pull_request = {
  number: 2,
  title: "fix: retry forum API requests on 429 rate limit",
  html_url: "https://github.com/vrchatapi/wiki-bot/pull/2",
  base: { ref: "main", repo: repository },
};

const reviewed = {
  event: "pull_request_review",
  action: "submitted",
  delivered_at: "2026-08-30T22:16:35Z",
  payload: {
    review: {
      id: 7001,
      state: "commented",
      body: "## Pull request overview\n\nLooks reasonable.",
      html_url: "https://github.com/vrchatapi/wiki-bot/pull/2#pullrequestreview-7001",
      submitted_at: "2026-08-30T22:16:34Z",
      user: sender,
    },
    pull_request,
    repository,
    sender,
  },
};

const commented = (id: number, reviewId: number | undefined, line: number) => ({
  event: "pull_request_review_comment",
  action: "created",
  delivered_at: `2026-08-30T22:16:36.${id.toString().padStart(3, "0")}Z`,
  payload: {
    comment: {
      id,
      pull_request_review_id: reviewId,
      body: `A note about line ${line}.`,
      path: "src/api/forum.ts",
      line,
      diff_hunk: "@@ -4,10 +4,22 @@\n+\tconst retry = 1;",
      html_url: `https://github.com/vrchatapi/wiki-bot/pull/2#discussion_r${id}`,
      created_at: "2026-08-30T22:16:36Z",
      user: sender,
    },
    pull_request,
    repository,
    sender,
  },
});

const fold = async (deliveries: object[]): Promise<World> => {
  const world = emptyWorld();

  for (const delivery of deliveries) {
    const event = {
      ...(delivery as { payload: object }).payload,
      type: `${(delivery as { event: string }).event}.${(delivery as { action: string }).action}`,
    };

    // Line comments draw nothing through the router for now; the fold itself is what is under test.
    const content =
      (delivery as { event: string }).event === "pull_request_review_comment"
        ? getReviewCommentContent(event as never, "organization")
        : await (async () => {
            const request = await getWebhookRequest("1/2", event as GithubEvent, "organization");
            return request ? await request.json() : undefined;
          })();

    apply(world, delivery as never, content ? { content } : {});
  }

  return world;
};

const drawn = (world: World) =>
  compose(world, repository, "organization").map((entry) => JSON.stringify(entry.content));

describe("a review and the comments it carries", () => {
  it("draws one message, not one for the review and one for each comment", async () => {
    const world = await fold([reviewed, commented(1, 7001, 22), commented(2, 7001, 19)]);
    const messages = drawn(world);

    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("A note about line 22.");
    expect(messages[0]).toContain("A note about line 19.");
  });

  it("puts the comments inside the review's own container", async () => {
    const world = await fold([reviewed, commented(1, 7001, 22)]);
    const [message] = compose(world, repository, "organization");
    const { components } = message!.content as {
      components: { type: number; components?: { content?: string }[] }[];
    };

    const container = components.find((component) => component.type === 17);

    expect(JSON.stringify(container)).toContain("A note about line 22.");
  });

  // Discord answers 400 to a container inside a container, which a fold can make by accident.
  it("nests no container inside the review's own", async () => {
    const world = await fold([reviewed, commented(1, 7001, 22)]);
    const [message] = compose(world, repository, "organization");
    const { components } = message!.content as {
      components: { type: number; components?: { type: number }[] }[];
    };

    for (const component of components)
      expect(component.components?.some((inner) => inner.type === 17) ?? false).toBe(false);
  });

  it("still draws a comment that belongs to no review of its own", async () => {
    const world = await fold([commented(3, undefined, 22)]);

    expect(drawn(world)).toHaveLength(1);
    expect(drawn(world)[0]).toContain("A note about line 22.");
  });
});
