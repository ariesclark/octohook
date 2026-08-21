import { SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A hook with no token on its url draws every board with no run names, numbers or triggers — and
 * with no trigger a run belongs to no push, so one commit becomes a message per workflow instead
 * of one board. That is worse than nothing arriving, and quiet about it, so it is refused: a red
 * delivery on the hook's own page is the only place anybody would see the problem.
 */

beforeEach(() => {
  vi.stubGlobal("fetch", async (input: RequestInfo) => {
    const url = typeof input === "string" ? input : (input as Request).url;

    if (url.startsWith("https://api.github.com")) return new Response(null, { status: 404 });
    return Response.json({ id: "message-1" });
  });
});

function deliver(query = "") {
  return SELF.fetch(`https://octohook.test/1234/webhook-token${query}`, {
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
});
