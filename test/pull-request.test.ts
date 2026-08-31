import { describe, expect, it } from "vitest";

import { getWebhookRequest } from "../src/discord";
import type { GithubEvent } from "../src/github";

const repository = {
  name: "wiki-bot",
  full_name: "vrchatapi/wiki-bot",
  html_url: "https://github.com/vrchatapi/wiki-bot",
};

const sender = { login: "kfarwell", avatar_url: "https://avatars.githubusercontent.com/u/2" };

const secret = "1/2";

const drawn = async (event: object, hook: "organization" | "repository" = "organization") => {
  const request = await getWebhookRequest(secret, event as GithubEvent, hook);
  return request ? await request.text() : null;
};

/** A message carrying a file is multipart, so its JSON has to be lifted back out of the body. */
const payload = (body: string) => {
  const start = body.indexOf("{", body.indexOf('name="payload_json"'));
  const end = body.indexOf("\r\n--", start);

  return JSON.parse(body.slice(start, end === -1 ? undefined : end)) as {
    components: { type: number; content?: string; components?: { type: number }[] }[];
  };
};

const fork = {
  name: "wiki-bot",
  full_name: "ariesclark/wiki-bot",
  html_url: "https://github.com/ariesclark/wiki-bot",
};

const pull = (action: string, over: object = {}) => ({
  type: `pull_request.${action}`,
  action,
  number: 2,
  pull_request: {
    number: 2,
    title: "fix: retry forum API requests on 429 rate limit",
    html_url: "https://github.com/vrchatapi/wiki-bot/pull/2",
    body: null,
    merged: false,
    draft: false,
    commits: 2,
    additions: 13,
    deletions: 1,
    changed_files: 1,
    head: { ref: "copilot/fix-failing-github-actions-job", sha: "269943d4", repo: repository },
    base: { ref: "main", repo: repository },
  },
  repository,
  sender,
  ...over,
});

const renamed = (over: object = {}) =>
  pull("edited", {
    changes: { title: { from: "[WIP] Fix failing GitHub Actions job run (1.1.22)" } },
    ...over,
  });

describe("a pull request renamed", () => {
  // A title is carried by every other message about the pull request, and a rename moves no code:
  // drawing one would also capture the checks, since the last note at a sha owns them.
  it("says nothing", async () => {
    expect(await drawn(renamed())).toBeNull();
  });
});

describe("a pull request edited in the body alone", () => {
  it("says nothing, rather than claiming a rename", async () => {
    expect(await drawn(pull("edited", { changes: { body: { from: "before" } } }))).toBeNull();
  });
});

describe("a pull request retargeted", () => {
  const retargeted = pull("edited", {
    changes: { base: { ref: { from: "develop" }, sha: { from: "269943d4" } } },
  });

  it("names the branch it used to target, and the one it targets now", async () => {
    const content = await drawn(retargeted);

    expect(content).toContain("retargeted");
    expect(content).toContain("[develop]");
    expect(content).toContain("[main]");
  });

  // "into" is the preposition of a merge, and nothing was merged.
  it("moves the target to the new branch rather than into it", async () => {
    const content = await drawn(retargeted);

    expect(content).toContain(") to [main]");
    expect(content).not.toContain(") into [main]");
  });
});

describe("a pull request updated with new commits", () => {
  // Checks triggered by the pull request hang under this note, so it has to be drawn.
  it("still draws a message for the checks that will attach to it", async () => {
    expect(await drawn(pull("synchronize"))).not.toBeNull();
  });

  const after = "1add34f1abcd2991191eba80b16c515856d039d6";

  it("says what the update was, not merely that there was one", async () => {
    const content = await drawn(pull("synchronize", { before: "08ac6ab4", after }));

    expect(content).toContain("updated");
    expect(content).toContain("wiki-bot#2");
    expect(content).not.toContain("copilot/fix-failing-github-actions-job");
  });

  it("links the sha it moved to, the way every other sha is linked", async () => {
    const content = await drawn(pull("synchronize", { before: "08ac6ab4", after }));

    expect(content).toContain(
      `[\`1add34f\`](https://github.com/vrchatapi/wiki-bot/commit/${after})`,
    );
  });

  it("links a fork's sha to the fork, where the commit actually lives", async () => {
    const base = pull("synchronize");
    const content = await drawn({
      ...base,
      before: "08ac6ab4",
      after,
      pull_request: { ...base.pull_request, head: { ref: "patch-1", sha: after, repo: fork } },
    });

    expect(content).toContain(`https://github.com/ariesclark/wiki-bot/commit/${after}`);
  });

  it("says only what moved, without repeating the title", async () => {
    const content = await drawn(pull("synchronize"));

    expect(content).not.toContain("fix: retry forum API requests");
    expect(payload(content!).components).toHaveLength(1);
  });

  it("says nothing about the size of the diff", async () => {
    const content = await drawn(pull("synchronize"));

    expect(content).not.toContain("diffstat.png");
    expect(content).not.toContain("2 commits");
    expect(content).not.toContain("-# ");
  });
});

describe("a pull request updated with nothing to point at", () => {
  it("says only that it moved when the payload carries no sha", async () => {
    const content = await drawn(pull("synchronize"));

    expect(content).toContain("updated [wiki-bot#2]");
    expect(content).not.toContain(") to **");
  });
});

describe("a pull request opened", () => {
  it("still says where it comes from and where it is going", async () => {
    const content = await drawn(pull("opened"));

    expect(content).toContain("copilot/fix-failing-github-actions-job");
    expect(content).toContain("[main]");
  });

  // What is merged is a branch, not the pull request's number.
  it("names the action it is, and merges a branch rather than a number", async () => {
    const content = await drawn(pull("opened"));

    expect(content).toContain("opened");
    expect(content).not.toContain("merge [wiki-bot#2]");
  });

  it("says nothing about drafts when it is open for review already", async () => {
    expect(await drawn(pull("opened"))).not.toContain("draft");
  });

  it("still shows the description", async () => {
    const content = await drawn(pull("opened", { pull_request: withBody("opened") }));

    expect(content).toContain("The forum returned a 429.");
  });
});

const withBody = (action: string) => ({
  ...pull(action).pull_request,
  body: "The forum returned a 429.",
});

describe("a pull request that changed state, not shape", () => {
  it("does not pair a close with branches, which reads as a merge that did not happen", async () => {
    const content = await drawn(pull("closed"));

    expect(content).toContain("closed");
    expect(content).not.toContain("copilot/fix-failing-github-actions-job");
    expect(content).not.toContain("wiki-bot:main");
  });

  // By the time it lands, the title has been said on every message before this one.
  it("says nothing but the landing when it merges: no title, no description", async () => {
    const merged = pull("closed", {
      pull_request: { ...withBody("closed"), merged: true },
    });
    const content = await drawn(merged);

    expect(content).toContain("merged");
    expect(content).not.toContain("fix: retry forum API requests");
    expect(content).not.toContain("The forum returned a 429.");
    expect(payload(content!).components).toHaveLength(1);
  });

  it("says which branch a merge landed on, without the branch it came from", async () => {
    const merged = pull("closed", {
      pull_request: { ...pull("closed").pull_request, merged: true },
    });
    const content = await drawn(merged);

    expect(content).toContain("merged");
    expect(content).toContain("into [main]");
    expect(content).not.toContain("copilot/fix-failing-github-actions-job");
  });

  it("reopens without repeating the branches, but with the description", async () => {
    const content = await drawn(pull("reopened", { pull_request: withBody("reopened") }));

    expect(content).toContain("reopened");
    expect(content).not.toContain("copilot/fix-failing-github-actions-job");
    expect(content).toContain("The forum returned a 429.");
  });

  it("keeps the verb next to what it did, marking ready for review", async () => {
    const content = await drawn(pull("ready_for_review", { pull_request: withBody("opened") }));

    expect(content).toContain(
      "**marked [wiki-bot#2](https://github.com/vrchatapi/wiki-bot/pull/2) ready for review**",
    );
  });

  // A draft's description is written by the time it is ready, not when it was opened.
  it("shows the description when it is put up for review", async () => {
    const content = await drawn(pull("ready_for_review", { pull_request: withBody("opened") }));

    expect(content).toContain("The forum returned a 429.");
  });
});

describe("where the title sits", () => {
  it("puts it in the container, not on the headline's own line", async () => {
    const request = await getWebhookRequest(secret, pull("opened") as GithubEvent, "organization");
    const [headline, container] = payload(await request!.text()).components;

    expect(headline!.content).not.toContain("fix: retry forum API requests");
    expect(container!.type).toBe(17);
    expect(JSON.stringify(container)).toContain("### fix: retry forum API requests");
  });

  // A section takes text displays alone, so the rule cannot sit beside the widget: Discord
  // answers 400 to a separator inside one. It is drawn only where something follows it.
  it("leaves the title unruled when nothing follows it", async () => {
    const body = (await drawn(pull("closed")))!;
    const container = payload(body).components[1]!;

    expect(container.components!.some((component) => component.type === 14)).toBe(false);
  });

  it("parts the title from the description with space rather than a rule", async () => {
    const body = (await drawn(pull("opened", { pull_request: withBody("opened") })))!;
    const container = payload(body).components[1]!;
    const separator = container.components![1] as { type: number; divider?: boolean };

    expect(separator.type).toBe(14);
    expect(separator.divider).toBe(false);
  });

  it("rules the title off from whatever follows it", async () => {
    const body = (await drawn(pull("opened", { pull_request: withBody("opened") })))!;
    const container = payload(body).components[1]!;

    expect(container.components![0]!.type).toBe(10);
    expect(container.components![1]!.type).toBe(14);
  });
});

describe("a repository the message has already named", () => {
  it("names it once, on the reference, and not again on either branch", async () => {
    const content = await drawn(pull("opened"));

    expect(content).toContain("wiki-bot#2");
    expect(content).toContain("[copilot/fix-failing-github-actions-job]");
    expect(content).toContain("[main]");
    expect(content).not.toContain("wiki-bot:main");
    expect(content).not.toContain("wiki-bot:copilot");
  });

  it("collapses the branches a merge and a retarget name", async () => {
    const merged = pull("closed", {
      pull_request: { ...pull("closed").pull_request, merged: true },
    });

    expect(await drawn(merged)).toContain("into [main]");

    const retargeted = pull("edited", { changes: { base: { ref: { from: "develop" } } } });
    const content = await drawn(retargeted);

    expect(content).toContain("from [develop]");
    expect(content).toContain("to [main]");
  });

  it("still names a fork, which the reference did not establish", async () => {
    const base = pull("opened");
    const content = await drawn({
      ...base,
      pull_request: { ...base.pull_request, head: { ref: "patch-1", sha: "269943d4", repo: fork } },
    });

    expect(content).toContain("ariesclark/wiki-bot:patch-1");
  });
});

describe("what a reader is told about where things live", () => {
  it("marks a fork's branch on an update, since the sha alone hides it", async () => {
    const base = pull("synchronize");
    const content = await drawn({
      ...base,
      before: "08ac6ab4",
      after: "1add34f1abcd2991191eba80b16c515856d039d6",
      pull_request: { ...base.pull_request, head: { ref: "patch-1", sha: "1add34f", repo: fork } },
    });

    expect(content).toContain("ariesclark/wiki-bot:patch-1");
  });

  it("drops the repository from the reference when the hook watches one repository", async () => {
    const content = await drawn(pull("synchronize"), "repository");

    expect(content).toContain("[#2](https://github.com/vrchatapi/wiki-bot/pull/2)");
    expect(content).not.toContain("wiki-bot#2");
  });
});
