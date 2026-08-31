import { describe, expect, it } from "vitest";

import { getWebhookRequest } from "../src/discord";
import { getReviewCommentContent } from "../src/discord/events/pull-request-review-comment";
import type { GithubEvent } from "../src/github";

const repository = {
  name: "wiki-bot",
  full_name: "vrchatapi/wiki-bot",
  html_url: "https://github.com/vrchatapi/wiki-bot",
};

const sender = { login: "ariesclark", avatar_url: "https://avatars.githubusercontent.com/u/1" };

const drawn = async (event: object): Promise<string | null> => {
  const request = await getWebhookRequest("1/2", event as GithubEvent, "organization");
  return request ? await request.text() : null;
};

/** Line comments draw nothing through the router for now, so the renderer is asked directly. */
const drawnComment = (event: object): string =>
  JSON.stringify(getReviewCommentContent(event as never, "organization"));

const review = (state: string, body: string | null = null, action = "submitted") => ({
  type: `pull_request_review.${action}`,
  action,
  review: {
    state,
    body,
    html_url: "https://github.com/vrchatapi/wiki-bot/pull/2#pullrequestreview-1",
    user: sender,
  },
  pull_request: {
    number: 2,
    title: "fix: retry forum API requests on 429 rate limit",
    html_url: "https://github.com/vrchatapi/wiki-bot/pull/2",
    head: { ref: "copilot/fix-failing-github-actions-job", repo: repository },
    base: { ref: "main", repo: repository },
  },
  repository,
  sender,
});

describe("a review submitted on a pull request", () => {
  it("says an approval, which is what lets the merge happen", async () => {
    const content = await drawn(review("approved"));

    expect(content).toContain("approved");
    expect(content).toContain("wiki-bot#2");
  });

  it("says when changes were asked for", async () => {
    expect(await drawn(review("changes_requested"))).toContain("requested changes on");
  });

  it("says a review that only comments, without claiming a verdict", async () => {
    const content = await drawn(review("commented", "## Pull request overview\n\nLooks fine."));

    expect(content).toContain("reviewed");
    expect(content).not.toContain("approved");
  });

  it("carries what the reviewer wrote", async () => {
    const content = await drawn(review("commented", "The middleware order looks wrong."));

    expect(content).toContain("The middleware order looks wrong.");
  });

  it("shows a long review the way it shows a long description: cut, with a way in", async () => {
    const long = Array.from(
      { length: 80 },
      (_, index) => `Paragraph ${index} of a long review.`,
    ).join("\n\n");

    const content = await drawn(review("commented", long));

    expect(content).toContain("Paragraph 0 of a long review.");
    expect(content).not.toContain("Paragraph 79 of a long review.");
    expect(content).toContain("See more");
    expect(content).toContain("#pullrequestreview-1");
  });

  it("leaves a short review whole, with nothing to follow", async () => {
    const content = await drawn(review("commented", "Looks good to me."));

    expect(content).toContain("Looks good to me.");
    expect(content).not.toContain("See more");
  });

  it("says nothing more than the verdict when the reviewer wrote nothing", async () => {
    const content = await drawn(review("approved"));

    expect(JSON.parse(content!).components).toHaveLength(1);
  });
});

const realHunk = [
  '@@ -4,10 +4,22 @@ import { userAgent } from "~/environment";',
  " ",
  ' import { cookie, log } from "./middleware";',
  " ",
  '+import type { ConfiguredMiddleware } from "wretch";',
  ' import type { operations } from "discourse2/lib/schema";',
  " ",
  "+const retry: ConfiguredMiddleware = (next) => async (url, options) => {",
  "+\tconst response = await next(url, options);",
  "+\tif (response.status === 429) {",
  '+\t\tconst retryAfterValue = parseInt(response.headers.get("retry-after") ?? "", 10);',
  "+\t\tconst retryAfter = Number.isNaN(retryAfterValue) ? 10 : retryAfterValue;",
  "+\t\tawait new Promise((resolve) => setTimeout(resolve, retryAfter * 1000));",
  "+\t\treturn next(url, options);",
  "+\t}",
  "+\treturn response;",
  "+};",
  "+",
  ' const base = wretch("https://ask.vrchat.com")',
  "-\t.middlewares([log, cookie])",
  "+\t.middlewares([log, retry, cookie])",
].join("\n");

const comment = (over: object = {}, action = "created") => ({
  type: `pull_request_review_comment.${action}`,
  action,
  comment: {
    body: "Put `retry` before `log` so each attempt is logged.",
    path: "src/api/forum.ts",
    line: 22,
    side: "RIGHT",
    diff_hunk: realHunk,
    html_url: "https://github.com/vrchatapi/wiki-bot/pull/2#discussion_r1",
    user: sender,
    ...over,
  },
  pull_request: {
    number: 2,
    title: "fix: retry forum API requests on 429 rate limit",
    html_url: "https://github.com/vrchatapi/wiki-bot/pull/2",
    base: { ref: "main", repo: repository },
  },
  repository,
  sender,
});

// GitHub draws the lines the comment covers, not the tail of the hunk it arrived in.
describe("how much of the diff a comment shows", () => {
  it("shows the commented line with a little context above it", async () => {
    const content = drawnComment(comment({ diff_hunk: realHunk, line: 22 }));
    const block = content!.slice(
      content!.indexOf("```diff"),
      content!.indexOf("```", content!.indexOf("```diff") + 3),
    );

    expect(block).toContain("+\\t.middlewares([log, retry, cookie])");
    expect(block).toContain("-\\t.middlewares([log, cookie])");
    expect(block).not.toContain("await new Promise");
    // The whole hunk is twenty rows; the comment's own region is a handful.
    expect(block.split("\\n").length).toBeLessThanOrEqual(7);
  });

  it("shows exactly the span when the comment covers several lines", async () => {
    const content = drawnComment(comment({ diff_hunk: realHunk, start_line: 10, line: 19 }));

    expect(content).toContain("+const retry: ConfiguredMiddleware");
    expect(content).toContain("+\\treturn response;");
    expect(content).not.toContain("middlewares([log, retry, cookie])");
  });
});

describe("a comment left on a line of the diff", () => {
  it("shows the lines it was left on, as a diff", async () => {
    const content = drawnComment(comment());

    expect(content).toContain("```diff");
    expect(content).toContain("+\\t.middlewares([log, retry, cookie])");
  });

  it("names the file and line, linked to the comment itself", async () => {
    const content = drawnComment(comment());

    expect(content).toContain("src/api/forum.ts:22");
    expect(content).toContain("https://github.com/vrchatapi/wiki-bot/pull/2#discussion_r1");
  });

  // The message is already about the pull request; naming it again says nothing.
  it("does not name the pull request the comment is plainly on", async () => {
    expect(drawnComment(comment())).not.toContain("wiki-bot#2");
  });

  it("shows the diff without the hunk header, which addresses nobody", async () => {
    expect(drawnComment(comment())).not.toContain("@@");
  });

  it("drops the blank rows that carry nothing", async () => {
    const content = drawnComment(comment());
    const block = content!.slice(content!.indexOf("```diff"));

    expect(block).not.toContain("\\n+\\n");
  });

  it("quotes what the reviewer wrote, so it reads apart from the diff", async () => {
    const content = drawnComment(comment());

    expect(content).toContain("> Put `retry` before `log`");
    expect(content).not.toContain("> > ");
  });

  it("draws no diff at all when the lines it covers are only whitespace", async () => {
    const blank = drawnComment(
      comment({ diff_hunk: "@@ -4,10 +4,22 @@ x\n+\n+   \n+\t", line: 6, start_line: 4 }),
    );

    expect(blank).not.toContain("```diff");
  });

  it("draws no diff when the comment covers more than a screenful", async () => {
    const rows = Array.from({ length: 40 }, (_, index) => `+line ${index}`).join("\n");
    const long = drawnComment(
      comment({ diff_hunk: `@@ -4,10 +4,60 @@ x\n${rows}`, start_line: 4, line: 43 }),
    );

    expect(long).not.toContain("```diff");
    expect(long).toContain("Put `retry` before `log`");
  });

  it("carries what the reviewer wrote", async () => {
    expect(drawnComment(comment())).toContain("Put `retry` before `log`");
  });

  it("names the span when the comment covers several lines", async () => {
    expect(drawnComment(comment({ start_line: 10, line: 19 }))).toContain("src/api/forum.ts:10-19");
  });
});

describe("the review events that are not a verdict", () => {
  it("says nothing when a review is dismissed", async () => {
    expect(await drawn(review("dismissed", null, "dismissed"))).toBeNull();
  });

  it("says nothing about a line comment, which its review already covers", async () => {
    expect(await drawn(comment())).toBeNull();
    expect(await drawn(comment({}, "edited"))).toBeNull();
  });
});
