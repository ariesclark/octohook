import { SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";

let nth = 0;
let channel = "";

beforeEach(() => {
  channel = `hook-${++nth}`;

  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const url = input instanceof Request ? input.url : String(input);

    if (url.startsWith("https://api.github.com")) return new Response(null, { status: 404 });

    if (url.startsWith("https://avatars.githubusercontent.com"))
      return new Response(
        Uint8Array.from(
          atob(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
          ),
          (character) => character.charCodeAt(0),
        ),
        { headers: { "content-type": "image/png" } },
      );

    return Response.json({ id: "message-1" });
  });
});

function deliver(query = "") {
  return SELF.fetch(`https://octohook.test/${channel}/webhook-token${query}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-github-event": "star" },
    body: JSON.stringify({
      action: "created",
      starred_at: "2026-08-21T01:00:00Z",
      repository: {
        name: "flirtual",
        full_name: "flirtual/flirtual",
        html_url: "https://github.com/flirtual/flirtual",
      },
      sender: { login: "aries", avatar_url: "https://github.com/aries.png" },
    }),
  });
}

describe("a hook without a token", () => {
  it("is refused, and says what is missing", async () => {
    const response = await deliver();

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      message: "No GitHub token on this hook's url. Add ?token=… to it.",
    });
  });

  it("is refused when the token is there but empty", async () => {
    expect((await deliver("?token=")).status).toBe(400);
  });

  it("is accepted once the url carries one", async () => {
    expect((await deliver("?token=a-token")).status).toBe(202);
  });

  it("takes an event a query will keep out of the channel anyway", async () => {
    const response = await deliver("?token=a-token&exclude=kind:star");

    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ changed: ["noted star.created"] });
  });

  it("says which words of a query it could not read", async () => {
    const response = await deliver("?token=a-token&exclude=check_run.conclusion:success");

    expect(await response.json()).toMatchObject({ refused: ["check_run.conclusion"] });
  });

  it("says what the fold made of it", async () => {
    const response = await deliver("?token=a-token");

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({
      message: "Event accepted.",
      changed: ["noted star.created"],
      revision: 1,
      drawAt: expect.any(Number),
      holding: { runs: 0, notes: 1, drawn: 0 },
    });
  });
});

describe("the avatars the worker draws", () => {
  const face = (id: number) => `https://avatars.githubusercontent.com/u/${id}?v=4`;

  it("refuses to fetch anywhere but GitHub", async () => {
    const asked = encodeURIComponent("https://example.com/pic.png");
    const response = await SELF.fetch(`https://octohook.test/avatars?u=${asked}`);

    expect(response.status).toBe(400);
  });

  it("refuses when it is asked for no one", async () => {
    expect((await SELF.fetch("https://octohook.test/avatars")).status).toBe(400);
  });

  it("draws the faces it was given, and lets them be cached", async () => {
    const asked = [face(1), face(2)].map((url) => `u=${encodeURIComponent(url)}`).join("&");
    const response = await SELF.fetch(`https://octohook.test/avatars?${asked}`);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toContain("immutable");
  });
});

describe("a deployment status off a workflow run", () => {
  const repository = {
    name: "flirtual",
    full_name: "flirtual/flirtual",
    html_url: "https://github.com/flirtual/flirtual",
  };

  const post = (state: string, environmentUrl: string) =>
    SELF.fetch(`https://octohook.test/${channel}/webhook-token?token=a-token`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-github-event": "deployment_status" },
      body: JSON.stringify({
        action: "created",
        repository,
        deployment: { id: 6092323147, environment: "canary", sha: "b504abd69b38" },
        deployment_status: {
          id: 1,
          state,
          environment: "canary",
          environment_url: environmentUrl,
          log_url: "https://github.com/flirtual/flirtual/actions/runs/32899961877/job/97972805937",
          target_url:
            "https://github.com/flirtual/flirtual/actions/runs/32899961877/job/97972805937",
          created_at: "2026-08-25T21:21:00Z",
          updated_at: "2026-08-25T21:21:00Z",
        },
        workflow_run: {
          id: 32899961877,
          html_url: "https://github.com/flirtual/flirtual/actions/runs/32899961877",
        },
        sender: { login: "kfarwell", avatar_url: "https://github.com/kfarwell.png" },
      }),
    });

  it("folds the success that ends a deployment it already called underway", async () => {
    expect(await (await post("in_progress", "")).json()).toMatchObject({
      changed: ["opened deployment 6092323147 → in_progress at canary"],
    });

    expect(await (await post("success", "https://api-b504abd.flirtual.dev")).json()).toMatchObject({
      changed: ["updated deployment 6092323147 → success at api-b504abd.flirtual.dev"],
    });
  });
});

describe("looking at what a channel is holding", () => {
  it("says nothing to somebody who does not know the hook", async () => {
    await deliver("?token=github-token");

    const response = await SELF.fetch("https://octohook.test/inspect/nobody/at-all");

    expect(response.status).toBe(404);
  });

  it("counts what it holds, and names each note it drew", async () => {
    await deliver("?token=github-token");

    const response = await SELF.fetch(`https://octohook.test/inspect/${channel}/webhook-token`);
    const body = await response.text();
    if (response.status !== 200) throw new Error(`${response.status} ${body}`);

    const world = JSON.parse(body) as {
      revision: number;
      holding: { notes: number; runs: number };
      notes: { key: string; kind: string; drawn: number }[];
    };

    expect(response.status).toBe(200);
    expect(world.holding.notes).toBe(1);
    expect(world.notes[0]!.kind).toBe("star");
    expect(world.revision).toBeGreaterThan(0);

    // Nothing is drawn until the alarm the fold set goes off.
    expect(world.notes[0]!.drawn).toBe(0);
  });

  it("carries no rendered content, which is the channel's job to show", async () => {
    await deliver("?token=github-token");

    const response = await SELF.fetch(`https://octohook.test/inspect/${channel}/webhook-token`);

    expect(await response.text()).not.toContain("components");
  });
});

describe("drawing a channel again", () => {
  it("sends every message it holds back to Discord", async () => {
    await deliver("?token=github-token");

    const posted: string[] = [];
    const inner = globalThis.fetch;

    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.startsWith("https://discord.com")) posted.push(url);

      return inner(input as RequestInfo, init);
    });

    const response = await SELF.fetch(`https://octohook.test/replay/${channel}/webhook-token`, {
      method: "POST",
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ pending: 0 });
    expect(posted.length).toBeGreaterThan(0);
  });

  it("renders each message again from the event that made it", async () => {
    await deliver("?token=github-token");

    const response = await SELF.fetch(`https://octohook.test/replay/${channel}/webhook-token`, {
      method: "POST",
    });

    // Nothing about the rendering changed, so every message is drawn again as it already was.
    expect(await response.json()).toMatchObject({ rendered: 1, changed: 0 });
  });

  it("leaves a note it has no event for alone", async () => {
    await deliver("?token=github-token");

    const before = await SELF.fetch(`https://octohook.test/inspect/${channel}/webhook-token`);
    const { notes } = (await before.json()) as { notes: { key: string; source: boolean }[] };

    expect(notes[0]!.source).toBe(true);
  });

  it("is not something a stranger can set off", async () => {
    await deliver("?token=github-token");

    const response = await SELF.fetch("https://octohook.test/replay/nobody/at-all", {
      method: "POST",
    });

    expect(response.status).toBe(404);
  });
});
