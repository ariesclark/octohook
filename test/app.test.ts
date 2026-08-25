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
