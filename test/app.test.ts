import { SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The one answer GitHub shows anybody. A token too broad for the two lookups has to come back as
 * a red delivery on the hook's own page, not as a line in a log nobody is reading.
 */

let scopes = "";

beforeEach(() => {
  vi.stubGlobal("fetch", async (input: RequestInfo) => {
    const url = typeof input === "string" ? input : (input as Request).url;

    if (url === "https://api.github.com/rate_limit")
      return new Response(null, { headers: { "x-oauth-scopes": scopes } });

    if (url.startsWith("https://api.github.com")) return new Response(null, { status: 404 });

    return Response.json({ id: "message-1" });
  });
});

function deliver(token: string) {
  return SELF.fetch(`https://octohook.test/1234/webhook-token?token=${token}`, {
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

describe("a hook's token", () => {
  it("refuses one carrying more than the lookups need, and says what to take off", async () => {
    scopes = "admin:org_hook, gist, read:org, repo, workflow";

    const response = await deliver("far-too-broad");

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      message: "Token carries more than octohook asks of it.",
      remove: ["admin:org_hook", "gist", "read:org", "workflow"],
      keep: ["repo", "public_repo"],
    });
  });

  it("accepts one carrying only what the lookups need", async () => {
    scopes = "repo";

    const response = await deliver("just-repo");

    expect(response.status).toBe(202);
  });
});
