import {
  env,
  evictDurableObject,
  runDurableObjectAlarm,
  runInDurableObject,
} from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Channel } from "../src/channel.ts";
import type { Folded } from "../src/foldable.ts";

/**
 * What only a runtime can answer: that a burst becomes one edit, that the world outlives the
 * isolate holding it, and that two deliveries at once both land. `node --test` covers the fold
 * and the drawing; nothing there can fire an alarm, and here the alarm is the delivery.
 */

/**
 * A channel of its own for every test. Storage outlives a test in this pool, and a channel that
 * still holds yesterday's world draws it again the moment the next test asks for a message.
 */
let nth = 0;
let channel = "";
let secret = "";

const repository = {
  name: "flirtual",
  full_name: "flirtual/flirtual",
  html_url: "https://github.com/flirtual/flirtual",
};

type Call = { method: string; url: string; body: Record<string, unknown> };

let calls: Call[] = [];
let posted = 0;

beforeEach(() => {
  calls = [];
  posted = 0;

  channel = `channel-${++nth}`;
  secret = `${channel}/token`;

  vi.stubGlobal("fetch", async (input: RequestInfo, init?: RequestInit) => {
    const url = typeof input === "string" ? input : (input as Request).url;

    // What a check run will not say about itself. Without the trigger a run belongs to no push
    // and is drawn on its own, which is the tokenless behaviour, not the one under test here.
    if (url.endsWith("/actions/runs/900"))
      return Response.json({ name: "frontend", run_number: 12, event: "push" });

    if (url.startsWith("https://api.github.com")) return new Response(null, { status: 404 });

    calls.push({
      method: init?.method ?? "GET",
      url,
      body: init?.body ? JSON.parse(String(init.body)) : {},
    });

    return Response.json({ id: `message-${++posted}` });
  });
});

const stub = (name = channel) => env.CHANNEL.getByName(name);

/**
 * Retention is measured against when a thing happened, so a fixture with a date written into it
 * is forgotten the moment it is folded. A moment is also a note's identity, so each one is taken
 * once and reused — asking twice gives two different instants and so two different messages.
 */
const secondsAgo = (seconds: number) => new Date(Date.now() - seconds * 1000).toISOString();

function push(at: string, sha: string): Folded {
  return {
    event: "push",
    action: null,
    delivered_at: at,
    payload: { repository, after: sha },
    content: { username: "octohook", components: [{ type: 10, content: `pushed ${sha}` }] },
  };
}

function job(at: string, sha: string, name: string, conclusion: string | null): Folded {
  return {
    event: "check_run",
    action: conclusion ? "completed" : "created",
    delivered_at: at,
    payload: {
      repository,
      check_run: {
        id: 1,
        name,
        status: conclusion ? "completed" : "in_progress",
        html_url: `https://github.com/flirtual/flirtual/actions/runs/900/job/${name}`,
        details_url: "https://github.com/flirtual/flirtual/actions/runs/900",
        head_sha: sha,
        conclusion,
        started_at: at,
        completed_at: conclusion ? at : null,
        check_suite: { id: 5, head_branch: "main" },
        app: { name: "GitHub Actions" },
      },
    },
  };
}

const sent = () => calls.filter(({ url }) => url.includes("discord.com"));
const posts = () => sent().filter(({ method }) => method === "POST");
const patches = () => sent().filter(({ method }) => method === "PATCH");
const deletes = () => sent().filter(({ method }) => method === "DELETE");

const lines = (call: Call) =>
  ((call.body.components ?? []) as Array<{ content?: string }>)
    .map(({ content }) => content)
    .filter(Boolean)
    .join("\n");

describe("Channel", () => {
  it("says nothing until the alarm, then says it once", async () => {
    const object = stub();
    const pushed = secondsAgo(30);

    await object.deliver(secret, "organization", [push(pushed, "abc1234")]);
    await object.deliver(secret, "organization", [job(secondsAgo(29), "abc1234", "b", null)]);
    await object.deliver(secret, "organization", [job(secondsAgo(28), "abc1234", "b", "failure")]);

    expect(sent()).toHaveLength(0);

    expect(await runDurableObjectAlarm(object)).toBe(true);

    expect(posts()).toHaveLength(1);
    expect(patches()).toHaveLength(0);
    expect(lines(posts()[0]!)).toContain("pushed abc1234");
  });

  it("edits the message it already has rather than posting another", async () => {
    const object = stub();

    await object.deliver(secret, "organization", [push(secondsAgo(30), "abc1234")]);
    await runDurableObjectAlarm(object);

    await object.deliver(secret, "organization", [
      job(secondsAgo(25), "abc1234", "typescript", "failure"),
    ]);
    await runDurableObjectAlarm(object);

    expect(posts()).toHaveLength(1);
    expect(patches()).toHaveLength(1);
    expect(patches()[0]!.url).toContain("/messages/message-1");
    expect(lines(patches()[0]!)).toContain("typescript");
  });

  it("spends no request when the world draws the same thing again", async () => {
    const object = stub();
    const pushed = secondsAgo(30);

    await object.deliver(secret, "organization", [push(pushed, "abc1234")]);
    await runDurableObjectAlarm(object);

    // The same delivery again: understood, folded, and identical once drawn.
    await object.deliver(secret, "organization", [push(pushed, "abc1234")]);
    await runDurableObjectAlarm(object);

    expect(sent()).toHaveLength(1);
  });

  // Hibernation discards everything in memory after a few seconds idle, and on every deploy.
  it("keeps the message it holds across being evicted", async () => {
    const object = stub();

    await object.deliver(secret, "organization", [push(secondsAgo(30), "abc1234")]);
    await runDurableObjectAlarm(object);

    await evictDurableObject(object);

    await object.deliver(secret, "organization", [
      job(secondsAgo(25), "abc1234", "typescript", "failure"),
    ]);
    await runDurableObjectAlarm(object);

    expect(posts()).toHaveLength(1);
    expect(patches()[0]!.url).toContain("/messages/message-1");
  });

  // An input gate opens on every await. A resolve in the middle of a read-modify-write would let
  // the second of these read the world before the first had written it, and one job would vanish.
  it("loses neither of two deliveries folded at once", async () => {
    const object = stub();

    await Promise.all([
      object.deliver(secret, "organization", [job(secondsAgo(30), "abc1234", "one", "success")]),
      object.deliver(secret, "organization", [job(secondsAgo(29), "abc1234", "two", "failure")]),
    ]);

    await runInDurableObject(stub(), async (_instance: Channel, state) => {
      const world = state.storage.kv.get<{ runs: Map<string, { jobs: Array<{ name: string }> }> }>(
        "world",
      )!;

      const names = [...world.runs.values()].flatMap(({ jobs }) => jobs.map(({ name }) => name));
      expect(names.sort()).toEqual(["one", "two"]);
    });
  });

  it("draws two channels apart from each other", async () => {
    const [one, two] = [`${channel}-one`, `${channel}-two`];

    await stub(one).deliver(`${one}/token`, "organization", [push(secondsAgo(30), "abc1234")]);
    await stub(two).deliver(`${two}/token`, "organization", [push(secondsAgo(30), "def5678")]);

    await runDurableObjectAlarm(stub(one));
    await runDurableObjectAlarm(stub(two));

    expect(posts()).toHaveLength(2);
    expect(posts()[0]!.url).toContain(`/webhooks/${one}/token`);
    expect(posts()[1]!.url).toContain(`/webhooks/${two}/token`);
  });

  // A message the world lets go of stays in the channel; only one it no longer draws comes down.
  it("stops redrawing a commit it has forgotten without taking it down", async () => {
    const object = stub();

    await object.deliver(secret, "organization", [
      push(new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString(), "abc1234"),
    ]);
    await runDurableObjectAlarm(object);

    await object.deliver(secret, "organization", [push(secondsAgo(1), "def5678")]);
    await runDurableObjectAlarm(object);

    expect(deletes()).toHaveLength(0);

    await runInDurableObject(object, async (_instance: Channel, state) => {
      expect([...state.storage.kv.list({ prefix: "sent:" })]).toHaveLength(1);
    });
  });
});
