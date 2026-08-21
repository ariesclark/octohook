import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { mergeAdjacent, mergeRequests, mergeRequestsWithSources } from "./merge.ts";

const secretA = "111111/token-a";
const secretB = "222222/token-b";

function textDisplay(content: string) {
  return { type: 10, content };
}

function webhookRequest(secret: string, components: unknown[]): Request {
  return new Request(`https://discord.com/api/webhooks/${secret}?with_components=true`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ flags: 32768, username: "GitHub", components }),
  });
}

async function bodies(requests: Request[]) {
  return Promise.all(requests.map((request) => request.clone().json() as Promise<any>));
}

describe("mergeRequests", () => {
  it("merges requests for the same secret into one", async () => {
    const merged = await mergeRequests([
      webhookRequest(secretA, [textDisplay("one")]),
      webhookRequest(secretA, [textDisplay("two")]),
    ]);

    assert.equal(merged.length, 1);
    assert.equal(merged[0].url, `https://discord.com/api/webhooks/${secretA}?with_components=true`);

    const [body] = await bodies(merged);
    assert.deepEqual(body.components, [textDisplay("one"), textDisplay("two")]);
    assert.equal(body.flags, 32768);
    assert.equal(body.username, "GitHub");
  });

  function asUser(username: string, content: string) {
    return new Request(`https://discord.com/api/webhooks/${secretA}?with_components=true`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        flags: 32768,
        username,
        avatar_url: `https://example.com/${username}.png`,
        components: [textDisplay(content)],
      }),
    });
  }

  it("merges consecutive messages sharing an identity", async () => {
    const merged = await mergeRequests([asUser("ariesclark", "one"), asUser("ariesclark", "two")]);

    assert.equal(merged.length, 1);

    const [body] = await bodies(merged);
    assert.equal(body.username, "ariesclark");
    assert.deepEqual(body.components, [textDisplay("one"), textDisplay("two")]);
  });

  it("keeps channel order when the identity changes mid-batch", async () => {
    const merged = await mergeRequests([
      asUser("ariesclark", "one"),
      asUser("kfarwell", "two"),
      asUser("ariesclark", "three"),
    ]);

    assert.equal(merged.length, 3);

    const [first, second, third] = await bodies(merged);
    assert.deepEqual(
      [first.username, second.username, third.username],
      ["ariesclark", "kfarwell", "ariesclark"],
    );
    assert.deepEqual(first.components, [textDisplay("one")]);
    assert.deepEqual(third.components, [textDisplay("three")]);
  });

  it("does not merge across a passthrough to the same webhook", async () => {
    const passthrough = new Request(`https://discord.com/api/webhooks/${secretA}/github`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-github-event": "push" },
      body: JSON.stringify({ ref: "refs/heads/main" }),
    });

    const merged = await mergeRequests([
      webhookRequest(secretA, [textDisplay("before")]),
      passthrough,
      webhookRequest(secretA, [textDisplay("after")]),
    ]);

    assert.equal(merged.length, 3);
    assert.equal(merged[1].url, `https://discord.com/api/webhooks/${secretA}/github`);

    const [first, , third] = await bodies(merged);
    assert.deepEqual(first.components, [textDisplay("before")]);
    assert.deepEqual(third.components, [textDisplay("after")]);
  });

  it("does not merge messages further apart than the window", async () => {
    const minute = 60_000;

    const merged = await mergeRequests(
      [
        webhookRequest(secretA, [textDisplay("one")]),
        webhookRequest(secretA, [textDisplay("two")]),
        webhookRequest(secretA, [textDisplay("three")]),
      ],
      { timestamps: [0, 10_000, 5 * minute], window: minute },
    );

    assert.equal(merged.length, 2);

    const [first, second] = await bodies(merged);
    assert.deepEqual(first.components, [textDisplay("one"), textDisplay("two")]);
    assert.deepEqual(second.components, [textDisplay("three")]);
  });

  it("keeps every message in batch order when identities interleave", async () => {
    const senders = ["github-actions", "ColinTheNanachi", "GitHub Actions", "GitHub"];

    const sequence = Array.from({ length: 24 }, (_, index) => ({
      username: senders[index % senders.length],
      content: `event-${index}`,
    }));

    const merged = await mergeRequests(
      sequence.map(({ username, content }) => asUser(username, content)),
      { timestamps: sequence.map((_, index) => index * 1000), window: 60_000 },
    );

    const rendered = (await bodies(merged)).flatMap(({ components }) =>
      components.map(({ content }: { content: string }) => content),
    );

    assert.deepEqual(
      rendered,
      sequence.map(({ content }) => content),
    );
  });

  it("does not merge requests for different secrets", async () => {
    const merged = await mergeRequests([
      webhookRequest(secretA, [textDisplay("one")]),
      webhookRequest(secretB, [textDisplay("two")]),
    ]);

    assert.equal(merged.length, 2);

    const [first, second] = await bodies(merged);
    assert.deepEqual(first.components, [textDisplay("one")]);
    assert.deepEqual(second.components, [textDisplay("two")]);
  });

  it("merges each secret separately in a mixed batch", async () => {
    const merged = await mergeRequests([
      webhookRequest(secretA, [textDisplay("a1")]),
      webhookRequest(secretB, [textDisplay("b1")]),
      webhookRequest(secretA, [textDisplay("a2")]),
    ]);

    assert.equal(merged.length, 2);

    const [first, second] = await bodies(merged);
    assert.deepEqual(first.components, [textDisplay("a1"), textDisplay("a2")]);
    assert.deepEqual(second.components, [textDisplay("b1")]);
  });

  it("splits when the merged message would exceed 4000 characters", async () => {
    const merged = await mergeRequests([
      webhookRequest(secretA, [textDisplay("x".repeat(2500))]),
      webhookRequest(secretA, [textDisplay("y".repeat(2500))]),
    ]);

    assert.equal(merged.length, 2);

    const [first, second] = await bodies(merged);
    assert.equal(first.components[0].content, "x".repeat(2500));
    assert.equal(second.components[0].content, "y".repeat(2500));
  });

  it("counts nested component text toward the character limit", async () => {
    const container = (content: string) => ({
      type: 17,
      components: [textDisplay(content)],
    });

    const merged = await mergeRequests([
      webhookRequest(secretA, [container("x".repeat(2500))]),
      webhookRequest(secretA, [container("y".repeat(2500))]),
    ]);

    assert.equal(merged.length, 2);
  });

  it("splits when the merged message would exceed 40 components", async () => {
    const first = Array.from({ length: 30 }, (_, index) => textDisplay(`a${index}`));
    const second = Array.from({ length: 30 }, (_, index) => textDisplay(`b${index}`));

    const merged = await mergeRequests([
      webhookRequest(secretA, first),
      webhookRequest(secretA, second),
    ]);

    assert.equal(merged.length, 2);

    const [one, two] = await bodies(merged);
    assert.equal(one.components.length, 30);
    assert.equal(two.components.length, 30);
  });

  it("leaves non-webhook-message requests untouched", async () => {
    const passthrough = new Request("https://discord.com/api/webhooks/333333/token-c/github", {
      method: "POST",
      headers: { "content-type": "application/json", "x-github-event": "push" },
      body: JSON.stringify({ ref: "refs/heads/main" }),
    });

    const merged = await mergeRequests([
      webhookRequest(secretA, [textDisplay("one")]),
      passthrough,
      webhookRequest(secretA, [textDisplay("two")]),
    ]);

    assert.equal(merged.length, 2);
    assert.equal(merged[1].url, "https://discord.com/api/webhooks/333333/token-c/github");
    assert.equal(merged[1].headers.get("x-github-event"), "push");

    const body = await merged[1].clone().json();
    assert.deepEqual(body, { ref: "refs/heads/main" });
  });

  it("reports which input requests fed each merged request", async () => {
    const passthrough = new Request("https://discord.com/api/webhooks/333333/token-c/github", {
      method: "POST",
      body: "raw",
    });

    const merged = await mergeRequestsWithSources([
      webhookRequest(secretA, [textDisplay("a1")]),
      passthrough,
      webhookRequest(secretB, [textDisplay("b1")]),
      webhookRequest(secretA, [textDisplay("a2")]),
    ]);

    assert.deepEqual(
      merged.map(({ sources }) => sources),
      [[0, 3], [1], [2]],
    );
  });

  it("reports sources per chunk when a merge splits", async () => {
    const merged = await mergeRequestsWithSources([
      webhookRequest(secretA, [textDisplay("x".repeat(2500))]),
      webhookRequest(secretA, [textDisplay("y".repeat(2500))]),
    ]);

    assert.deepEqual(
      merged.map(({ sources }) => sources),
      [[0], [1]],
    );
  });

  it("returns a single request unchanged", async () => {
    const merged = await mergeRequests([webhookRequest(secretA, [textDisplay("only")])]);

    assert.equal(merged.length, 1);

    const [body] = await bodies(merged);
    assert.deepEqual(body.components, [textDisplay("only")]);
  });
});

describe("order", () => {
  /** Every line of text a set of requests would post, in the order a reader would meet them. */
  async function lines(requests: Request[]) {
    const parsed = await bodies(requests);

    return parsed.flatMap(({ components }) =>
      (components as { type: number; content?: string; components?: { content?: string }[] }[])
        .flatMap(
          (component) => component.content ?? component.components?.map((i) => i.content) ?? [],
        )
        .filter((content): content is string => typeof content === "string"),
    );
  }

  function asUserAt(username: string, content: string, secret = secretA) {
    return new Request(`https://discord.com/api/webhooks/${secret}?with_components=true`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ flags: 32768, username, components: [textDisplay(content)] }),
    });
  }

  it("says the same things in the same order as sending one by one", async () => {
    const requests = [
      asUserAt("flitty-bot", "pushed 1 new commit"),
      asUserAt("GitHub Actions", "deploying #277"),
      asUserAt("GitHub Actions", "eslint passed"),
      asUserAt("flitty-bot", "opened #278"),
      asUserAt("GitHub Actions", "deployed #277"),
    ];

    const expected = await lines(requests);

    const merged = await mergeRequests(requests, {
      timestamps: requests.map((_, index) => index * 1000),
      window: 60_000,
    });

    assert.ok(merged.length < requests.length, "expected some merging to happen");
    assert.deepEqual(await lines(merged), expected);
  });

  it("keeps order when nothing merges, across identities and secrets", async () => {
    const requests = [
      asUserAt("one", "a"),
      asUserAt("two", "b"),
      asUserAt("one", "c", secretB),
      asUserAt("one", "d"),
    ];

    const mine = (secret: string) => (request: Request) => request.url.includes(secret);
    const expected = new Map([
      [secretA, await lines(requests.filter(mine(secretA)))],
      [secretB, await lines(requests.filter(mine(secretB)))],
    ]);

    const merged = await mergeRequests(requests, {
      timestamps: requests.map((_, index) => index * 1000),
      window: 60_000,
    });

    // Different secrets go to different channels, so compare within each.
    for (const secret of [secretA, secretB])
      assert.deepEqual(await lines(merged.filter(mine(secret))), expected.get(secret));
  });

  it("keeps order when a gap in time splits a run apart", async () => {
    const requests = [
      asUserAt("GitHub Actions", "first"),
      asUserAt("GitHub Actions", "second"),
      asUserAt("GitHub Actions", "third"),
    ];

    const expected = await lines(requests);

    const merged = await mergeRequests(requests, {
      timestamps: [0, 1000, 10 * 60 * 1000],
      window: 60_000,
    });

    assert.equal(merged.length, 2, "the late one should not join the pair");
    assert.deepEqual(await lines(merged), expected);
  });
});

describe("completeness", () => {
  async function lines(requests: Request[]) {
    const parsed = await bodies(requests);

    return parsed.flatMap(({ components }) =>
      (components as { type: number; content?: string; components?: { content?: string }[] }[])
        .flatMap(
          (component) => component.content ?? component.components?.map((i) => i.content) ?? [],
        )
        .filter((content): content is string => typeof content === "string"),
    );
  }

  function asUserAt(username: string, content: string, secret = secretA) {
    return new Request(`https://discord.com/api/webhooks/${secret}?with_components=true`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ flags: 32768, username, components: [textDisplay(content)] }),
    });
  }

  const batch = () => [
    asUserAt("flitty-bot", "one"),
    asUserAt("flitty-bot", "two"),
    asUserAt("GitHub Actions", "three"),
    asUserAt("GitHub Actions", "four"),
    asUserAt("flitty-bot", "five"),
    asUserAt("flitty-bot", "six", secretB),
  ];

  it("posts every line it was given, and no others", async () => {
    const requests = batch();
    const expected = await lines(requests);

    const merged = await mergeRequests(requests, {
      timestamps: requests.map((_, index) => index * 1000),
      window: 60_000,
    });

    const actual = await lines(merged);

    assert.equal(actual.length, expected.length, "a line was lost or invented");
    assert.deepEqual([...actual].sort(), [...expected].sort());
  });

  it("never repeats a line", async () => {
    const requests = batch();

    const merged = await mergeRequests(requests, {
      timestamps: requests.map((_, index) => index * 1000),
      window: 60_000,
    });

    const actual = await lines(merged);

    assert.equal(new Set(actual).size, actual.length, "a line was posted twice");
  });

  it("accounts for every source exactly once", async () => {
    const requests = batch();

    const merged = await mergeRequestsWithSources(requests, {
      timestamps: requests.map((_, index) => index * 1000),
      window: 60_000,
    });

    const sources = merged.flatMap(({ sources }) => sources).sort((a, b) => a - b);

    assert.deepEqual(sources, [0, 1, 2, 3, 4, 5]);
  });

  it("sends nothing when given nothing", async () => {
    assert.deepEqual(await mergeRequests([]), []);
  });

  it("leaves a single request alone", async () => {
    const requests = [asUserAt("flitty-bot", "only")];
    const expected = await lines(requests);

    const merged = await mergeRequests(requests, { timestamps: [0], window: 60_000 });

    assert.equal(merged.length, 1);
    assert.deepEqual(await lines(merged), expected);
  });
});

describe("mergeAdjacent", () => {
  const drawn = (key: string, at: string, content: string, voice = "octohook") => ({
    key,
    at,
    content: { username: voice, components: [{ content }] },
    merges: true,
  });

  // Two stars a moment apart are one thing happening, and read as two messages only because
  // GitHub sent two deliveries. The queue used to fold them together on the way out; drawing the
  // channel from a world has to do it here, or it stops happening on every redraw.
  it("says two things in one voice, a moment apart, as one message", () => {
    const merged = mergeAdjacent(
      [drawn("a", "2026-08-21T01:00:00Z", "one"), drawn("b", "2026-08-21T01:00:30Z", "two")],
      60_000,
    );

    assert.equal(merged.length, 1);
    assert.deepEqual(merged[0]!.content.components, [{ content: "one" }, { content: "two" }]);
  });

  // The first key, so the message keeps the id it was posted under as the group grows.
  it("keeps the key of the message the group started as", () => {
    const merged = mergeAdjacent(
      [drawn("a", "2026-08-21T01:00:00Z", "one"), drawn("b", "2026-08-21T01:00:30Z", "two")],
      60_000,
    );

    assert.equal(merged[0]!.key, "a");
    assert.equal(merged[0]!.at, "2026-08-21T01:00:00Z");
  });

  it("keeps two things further apart than the window separate", () => {
    const merged = mergeAdjacent(
      [drawn("a", "2026-08-21T01:00:00Z", "one"), drawn("b", "2026-08-21T01:05:00Z", "two")],
      60_000,
    );

    assert.equal(merged.length, 2);
  });

  it("keeps two voices apart however close together they are", () => {
    const merged = mergeAdjacent(
      [
        drawn("a", "2026-08-21T01:00:00Z", "one", "octohook"),
        drawn("b", "2026-08-21T01:00:05Z", "two", "someone else"),
      ],
      60_000,
    );

    assert.equal(merged.length, 2);
  });

  // A push grows a board under it as its runs report. Merged into its neighbour it would have to
  // be torn out again the moment the first check arrived.
  it("never merges a message something can still be drawn under", () => {
    const board = { ...drawn("a", "2026-08-21T01:00:00Z", "one"), merges: false };
    const merged = mergeAdjacent([board, drawn("b", "2026-08-21T01:00:05Z", "two")], 60_000);

    assert.equal(merged.length, 2);
  });

  it("does not reach across something that will not merge", () => {
    const merged = mergeAdjacent(
      [
        drawn("a", "2026-08-21T01:00:00Z", "one"),
        { ...drawn("b", "2026-08-21T01:00:05Z", "board"), merges: false },
        drawn("c", "2026-08-21T01:00:10Z", "two"),
      ],
      60_000,
    );

    assert.deepEqual(
      merged.map(({ key }) => key),
      ["a", "b", "c"],
    );
  });

  it("leaves a lone message exactly as it was drawn", () => {
    const only = drawn("a", "2026-08-21T01:00:00Z", "one");
    assert.deepEqual(mergeAdjacent([only], 60_000), [only]);
  });

  it("draws nothing from nothing", () => {
    assert.deepEqual(mergeAdjacent([], 60_000), []);
  });
});
