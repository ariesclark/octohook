import {
  env,
  evictDurableObject,
  runDurableObjectAlarm,
  runInDurableObject,
} from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Channel } from "../src/channel.ts";
import { foldablePayload, type Folded } from "../src/foldable.ts";

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
let lookups: Array<{ url: string; authorization: string | null }> = [];
let posted = 0;

const token = "github-token";

beforeEach(() => {
  calls = [];
  lookups = [];
  posted = 0;

  channel = `channel-${++nth}`;
  secret = `${channel}/token`;

  vi.stubGlobal("fetch", async (input: RequestInfo, init?: RequestInit) => {
    const url = typeof input === "string" ? input : (input as Request).url;

    if (url.startsWith("https://api.github.com")) {
      lookups.push({ url, authorization: new Headers(init?.headers).get("authorization") });

      if (url.endsWith("/actions/runs/900"))
        return Response.json({ name: "frontend", run_number: 12, event: "push" });

      return new Response(null, { status: 404 });
    }

    calls.push({
      method: init?.method ?? "GET",
      url,
      body: init?.body ? JSON.parse(String(init.body)) : {},
    });

    return Response.json({ id: `message-${++posted}` });
  });
});

const stub = (name = channel) => env.CHANNEL.getByName(name);

const deliver = (
  object: ReturnType<typeof stub>,
  deliveries: Folded[],
  to = secret,
  query?: { include?: string; exclude?: string },
) => object.deliver({ secret: to, hook: "organization", token, query, deliveries });

const secondsAgo = (seconds: number) => new Date(Date.now() - seconds * 1000).toISOString();

function push(at: string, sha: string, received = at): Folded {
  return {
    event: "push",
    action: null,
    delivered_at: at,
    received_at: received,
    payload: { repository, after: sha },
    content: { username: "octohook", components: [{ type: 10, content: `pushed ${sha}` }] },
  };
}

function job(at: string, sha: string, name: string, conclusion: string | null): Folded {
  return {
    event: "check_run",
    action: conclusion ? "completed" : "created",
    delivered_at: at,
    received_at: at,
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

    await deliver(object, [push(pushed, "abc1234")]);
    await deliver(object, [job(secondsAgo(29), "abc1234", "b", null)]);
    await deliver(object, [job(secondsAgo(28), "abc1234", "b", "failure")]);

    expect(sent()).toHaveLength(0);

    expect(await runDurableObjectAlarm(object)).toBe(true);

    expect(posts()).toHaveLength(1);
    expect(patches()).toHaveLength(0);
    expect(lines(posts()[0]!)).toContain("pushed abc1234");
  });

  it("edits the message it already has rather than posting another", async () => {
    const object = stub();

    await deliver(object, [push(secondsAgo(30), "abc1234")]);
    await runDurableObjectAlarm(object);

    await deliver(object, [job(secondsAgo(25), "abc1234", "typescript", "failure")]);
    await runDurableObjectAlarm(object);

    expect(posts()).toHaveLength(1);
    expect(patches()).toHaveLength(1);
    expect(patches()[0]!.url).toContain("/messages/message-1");
    expect(lines(patches()[0]!)).toContain("typescript");
  });

  it("spends no request when the world draws the same thing again", async () => {
    const object = stub();
    const pushed = secondsAgo(30);

    await deliver(object, [push(pushed, "abc1234")]);
    await runDurableObjectAlarm(object);

    await deliver(object, [push(pushed, "abc1234")]);
    await runDurableObjectAlarm(object);

    expect(sent()).toHaveLength(1);
  });

  it("keeps the message it holds across being evicted", async () => {
    const object = stub();

    await deliver(object, [push(secondsAgo(30), "abc1234")]);
    await runDurableObjectAlarm(object);

    await evictDurableObject(object);

    await deliver(object, [job(secondsAgo(25), "abc1234", "typescript", "failure")]);
    await runDurableObjectAlarm(object);

    expect(posts()).toHaveLength(1);
    expect(patches()[0]!.url).toContain("/messages/message-1");
  });

  it("loses neither of two deliveries folded at once", async () => {
    const object = stub();

    await Promise.all([
      deliver(object, [job(secondsAgo(30), "abc1234", "one", "success")]),
      deliver(object, [job(secondsAgo(29), "abc1234", "two", "failure")]),
    ]);

    await runInDurableObject(stub(), async (_instance: Channel, state) => {
      const runs = [
        ...state.storage.kv.list<{ jobs: Array<{ name: string }> }>({ prefix: "run:" }),
      ];
      const names = runs.flatMap(([, run]) => run.jobs.map(({ name }) => name));

      expect(names.sort()).toEqual(["one", "two"]);
    });
  });

  it("draws two channels apart from each other", async () => {
    const [one, two] = [`${channel}-one`, `${channel}-two`];

    await deliver(stub(one), [push(secondsAgo(30), "abc1234")], `${one}/token`);
    await deliver(stub(two), [push(secondsAgo(30), "def5678")], `${two}/token`);

    await runDurableObjectAlarm(stub(one));
    await runDurableObjectAlarm(stub(two));

    expect(posts()).toHaveLength(2);
    expect(posts()[0]!.url).toContain(`/webhooks/${one}/token`);
    expect(posts()[1]!.url).toContain(`/webhooks/${two}/token`);
  });

  it("looks up a run with the token the delivery carried", async () => {
    await stub().deliver({
      secret,
      hook: "organization",
      token: "a-particular-token",
      deliveries: [job(secondsAgo(30), "abc1234", "build", "success")],
    });

    expect(lookups).toHaveLength(1);
    expect(lookups[0]!.url).toContain("/actions/runs/900");
    expect(lookups[0]!.authorization).toBe("Bearer a-particular-token");
  });

  it("looks nothing up when the hook carries no token", async () => {
    await stub().deliver({
      secret,
      hook: "organization",
      deliveries: [job(secondsAgo(30), "abc1234", "build", "success")],
    });

    expect(lookups).toHaveLength(0);
  });

  it("never writes the token to storage", async () => {
    await deliver(stub(), [push(secondsAgo(30), "abc1234")]);

    await runInDurableObject(stub(), async (_instance: Channel, state) => {
      const stored = [...state.storage.kv.list({})].map(([, value]) => JSON.stringify(value));
      expect(stored.some((value) => value.includes(token))).toBe(false);
    });
  });

  it("stops redrawing a commit it has forgotten without taking it down", async () => {
    const object = stub();

    const longAgo = new Date(Date.now() - 49 * 60 * 60 * 1000).toISOString();
    await deliver(object, [push(longAgo, "abc1234", longAgo)]);
    await runDurableObjectAlarm(object);

    await deliver(object, [push(secondsAgo(1), "def5678")]);
    await runDurableObjectAlarm(object);

    expect(deletes()).toHaveLength(0);

    await runInDurableObject(object, async (_instance: Channel, state) => {
      expect([...state.storage.kv.list({ prefix: "sent:" })]).toHaveLength(1);
    });
  });

  it("keeps every run under a key of its own", async () => {
    const object = stub();

    await deliver(object, [push(secondsAgo(30), "abc1234")]);
    await deliver(object, [job(secondsAgo(29), "abc1234", "build", "success")]);

    await runInDurableObject(object, async (_instance: Channel, state) => {
      const keys = [...state.storage.kv.list({})].map(([key]) => key);

      expect(keys).toContain("run:900");
      expect(keys).toContain("notes");
      expect(keys).not.toContain("world");
    });
  });

  it("lets go of a forgotten run's key, not just its message", async () => {
    const object = stub();

    await deliver(object, [job(secondsAgo(30), "abc1234", "build", "success")]);
    await runDurableObjectAlarm(object);

    expect(posts()).toHaveLength(1);

    await runInDurableObject(object, async (_instance: Channel, state) => {
      const { kv } = state.storage;
      const run = kv.get<{ seen: string }>("run:900")!;

      kv.put("run:900", {
        ...run,
        seen: new Date(Date.now() - 49 * 60 * 60 * 1000).toISOString(),
      });
    });

    await deliver(object, [push(secondsAgo(1), "def5678")]);
    await runDurableObjectAlarm(object);

    await runInDurableObject(object, async (_instance: Channel, state) => {
      const keys = [...state.storage.kv.list({})].map(([key]) => key);

      expect(keys.filter((key) => key.startsWith("run:"))).toEqual([]);
      expect(keys.filter((key) => key.startsWith("sent:"))).toHaveLength(1);
    });

    expect(deletes()).toHaveLength(0);
  });

  it("splits a world left behind by the previous shape, rather than losing it", async () => {
    const object = stub();
    const at = secondsAgo(30);

    await runInDurableObject(object, async (_instance: Channel, state) => {
      const { kv } = state.storage;

      kv.put("world", {
        runs: new Map([
          ["900", { id: "900", at, seen: at, jobs: [], deployments: [], repository }],
        ]),
        notes: [
          {
            key: `push.:${at}`,
            at,
            seen: at,
            kind: "push",
            repository,
            sha: "abc1234",
            content: {
              username: "octohook",
              components: [{ type: 10, content: "pushed abc1234" }],
            },
          },
        ],
      });

      kv.put("meta", { secret, hook: "organization", repository });
      kv.put("flushAt", Date.now());

      await state.storage.setAlarm(Date.now() + 1000);
    });

    expect(await runDurableObjectAlarm(object)).toBe(true);

    expect(deletes()).toHaveLength(0);
    expect(posts()).toHaveLength(2);
    expect(posts().map(lines).join("\n")).toContain("pushed abc1234");

    await runInDurableObject(object, async (_instance: Channel, state) => {
      const keys = [...state.storage.kv.list({})].map(([key]) => key);

      expect(keys).toContain("run:900");
      expect(keys).not.toContain("world");
    });
  });
});

describe("a delete Discord will not take", () => {
  const refuse = () => {
    const inner = globalThis.fetch as typeof fetch;

    vi.stubGlobal("fetch", async (input: RequestInfo, init?: RequestInit) => {
      const url = typeof input === "string" ? input : (input as Request).url;

      if (init?.method === "DELETE" && url.includes("discord.com")) {
        calls.push({ method: "DELETE", url, body: {} });
        return new Response(null, { status: 500 });
      }

      return inner(input, init);
    });
  };

  const stored = async (object: ReturnType<typeof stub>, key: string) =>
    runInDurableObject(object, (_instance, state) => state.storage.kv.get(key));

  it("keeps the message on the books and comes back for it", async () => {
    const object = stub();

    await deliver(object, [push(secondsAgo(30), "abc1234")]);
    await runDurableObjectAlarm(object);
    refuse();

    await deliver(object, [push(secondsAgo(20), "def5678")], secret, { exclude: "type:push" });
    await runDurableObjectAlarm(object);

    expect(deletes().length).toBeGreaterThan(0);
    expect(await stored(object, "drains")).toBe(1);
    expect(await stored(object, "pendingSince")).toBeUndefined();
    expect(Number(await stored(object, "flushAt"))).toBeGreaterThan(Date.now());
  });

  it("stops coming back once it has tried long enough", async () => {
    const object = stub();

    await deliver(object, [push(secondsAgo(30), "abc1234")]);
    await runDurableObjectAlarm(object);
    refuse();

    await runInDurableObject(object, (_instance, state) => state.storage.kv.put("drains", 40));
    await deliver(object, [push(secondsAgo(20), "def5678")], secret, { exclude: "type:push" });
    await runDurableObjectAlarm(object);

    expect(await stored(object, "drains")).toBeUndefined();
  });
});

describe("a run still in flight", () => {
  const stored = async (object: ReturnType<typeof stub>, key: string) =>
    runInDurableObject(object, (_instance, state) => state.storage.kv.get(key));

  it("keeps asking what step it is on", async () => {
    const object = stub();

    await deliver(object, [job(secondsAgo(10), "abc1234", "build", null)]);
    await runDurableObjectAlarm(object);

    expect(lookups.some(({ url }) => url.includes("/jobs"))).toBe(true);
    expect(Number(await stored(object, "flushAt"))).toBeGreaterThan(Date.now());
  });

  it("gives up on a run that never finishes", async () => {
    const object = stub();

    await deliver(object, [job(secondsAgo(10), "abc1234", "build", null)]);
    await runInDurableObject(object, (_instance, state) => state.storage.kv.put("watches", 500));
    await runDurableObjectAlarm(object);

    expect(await stored(object, "watches")).toBeUndefined();
  });
});

describe("what the channel answers GitHub with", () => {
  it("says what it is holding", async () => {
    const object = stub();

    await deliver(object, [push(secondsAgo(30), "abc1234")]);
    const outcome = await deliver(object, [job(secondsAgo(29), "abc1234", "build", null)]);

    expect(outcome.holding).toEqual({ runs: 1, notes: 1, drawn: 0 });
  });

  it("counts what it has drawn once it has drawn it", async () => {
    const object = stub();

    await deliver(object, [push(secondsAgo(30), "abc1234")]);
    await runDurableObjectAlarm(object);

    const outcome = await deliver(object, [push(secondsAgo(20), "def5678")]);

    expect(outcome.holding.drawn).toBe(1);
  });

  it("posts a message a refused draw left behind, once Discord takes it", async () => {
    const object = stub();
    const inner = globalThis.fetch as typeof fetch;
    let refusing = true;

    vi.stubGlobal("fetch", async (input: RequestInfo, init?: RequestInit) => {
      const url = typeof input === "string" ? input : (input as Request).url;

      if (refusing && url.includes("discord.com") && init?.method === "POST")
        return new Response("bad", { status: 400 });

      return inner(input, init);
    });

    await deliver(object, [push(secondsAgo(30), "abc1234")]);
    await runDurableObjectAlarm(object);

    expect(posts()).toHaveLength(0);

    refusing = false;
    await deliver(object, [push(secondsAgo(20), "def5678")]);
    await runDurableObjectAlarm(object);

    expect(posts()).toHaveLength(2);
    expect(lines(posts()[0]!)).toContain("pushed abc1234");
  });

  it("reports a message Discord would not take", async () => {
    const object = stub();
    const inner = globalThis.fetch as typeof fetch;

    vi.stubGlobal("fetch", async (input: RequestInfo, init?: RequestInit) => {
      const url = typeof input === "string" ? input : (input as Request).url;

      if (url.includes("discord.com") && init?.method === "POST")
        return new Response("bad", { status: 400 });

      return inner(input, init);
    });

    await deliver(object, [push(secondsAgo(30), "abc1234")]);
    await runDurableObjectAlarm(object);

    const outcome = await deliver(object, [push(secondsAgo(20), "def5678")]);

    expect(outcome.trouble?.keys).toHaveLength(1);
    expect(outcome.trouble?.at).toEqual(expect.any(String));
  });
});

describe("a repository's query", () => {
  it("keeps out what it names, and lets the rest through", async () => {
    const object = stub();

    await deliver(object, [push(secondsAgo(30), "abc1234")], secret, { exclude: "type:push" });
    await runDurableObjectAlarm(object);

    expect(posts()).toHaveLength(0);
  });

  it("keeps out a bot the rendering saw, though the fold did not keep it", async () => {
    const object = stub();
    const pushed = {
      ...push(secondsAgo(30), "abc1234"),
      facts: { sender: { login: "renovate[bot]", type: "Bot" } },
    };

    await deliver(object, [pushed], secret, { exclude: "bot:true" });
    await runDurableObjectAlarm(object);

    expect(posts()).toHaveLength(0);
  });

  it("takes down what it stops drawing", async () => {
    const object = stub();

    await deliver(object, [push(secondsAgo(30), "abc1234")]);
    await runDurableObjectAlarm(object);

    expect(posts()).toHaveLength(1);

    await deliver(object, [push(secondsAgo(20), "def5678")], secret, { exclude: "type:push" });
    await runDurableObjectAlarm(object);

    expect(deletes()).toHaveLength(1);
  });

  it("is forgotten once nothing in the channel is from that repository", async () => {
    const object = stub();
    const old = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString();

    await deliver(object, [push(old, "abc1234", old)], secret, { exclude: "type:issues" });
    await runDurableObjectAlarm(object);

    expect(
      await runInDurableObject(object, (_instance, state) =>
        state.storage.kv.get("query:flirtual/flirtual"),
      ),
    ).toBeUndefined();
  });

  it("speaks only for the repository whose hook carried it", async () => {
    const object = stub();
    const other = {
      name: "wiki-bot",
      full_name: "flirtual/wiki-bot",
      html_url: "https://github.com/flirtual/wiki-bot",
    };

    await deliver(object, [push(secondsAgo(30), "abc1234")], secret, { exclude: "type:push" });
    await deliver(
      object,
      [
        {
          ...push(secondsAgo(25), "def5678"),
          payload: { repository: other, after: "def5678" },
        },
      ],
      secret,
    );

    await runDurableObjectAlarm(object);

    expect(posts()).toHaveLength(1);
    expect(lines(posts()[0]!)).toContain("pushed def5678");
  });
});
