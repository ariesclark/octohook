import { SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";

let nth = 0;
let channel = "";

beforeEach(() => {
  channel = `hook-${++nth}`;

  vi.stubGlobal("fetch", async (input: RequestInfo) => {
    const url = typeof input === "string" ? input : (input as Request).url;

    if (url.startsWith("https://api.github.com")) return new Response(null, { status: 404 });
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

  it("says what the fold made of it", async () => {
    const response = await deliver("?token=a-token");

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({
      message: "Event accepted.",
      changed: ["noted star.created"],
      revision: 1,
      drawAt: expect.any(Number),
    });
  });
});
