import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";

import { excessScopes } from "./token.ts";

const real = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = real;
});

let asked = 0;

/** `null` for the header a fine-grained token does not send at all. */
function github(scopes: string | null, status = 200) {
  asked = 0;

  globalThis.fetch = (async () => {
    asked += 1;
    return new Response(null, {
      status,
      headers: scopes === null ? {} : { "x-oauth-scopes": scopes },
    });
  }) as typeof fetch;
}

describe("excessScopes", () => {
  test("passes a token carrying only what the lookups need", async () => {
    github("repo");
    assert.deepEqual(await excessScopes("only-repo"), []);

    github("public_repo");
    assert.deepEqual(await excessScopes("only-public"), []);
  });

  test("names every scope the lookups have no use for", async () => {
    github("admin:org_hook, gist, read:org, repo, workflow");

    assert.deepEqual(await excessScopes("a-broad-token"), [
      "admin:org_hook",
      "gist",
      "read:org",
      "workflow",
    ]);
  });

  // A fine-grained or app token sends no scopes header: what it may do was decided when it was made.
  test("passes a token that reports no scopes at all", async () => {
    github(null);
    assert.deepEqual(await excessScopes("fine-grained"), []);
  });

  test("passes a token whose scope list is empty", async () => {
    github("");
    assert.deepEqual(await excessScopes("no-scopes"), []);
  });

  test("asks GitHub once however many deliveries carry the token", async () => {
    github("repo");

    await excessScopes("asked-once");
    await excessScopes("asked-once");
    await excessScopes("asked-once");

    assert.equal(asked, 1);
  });

  // Refusing every delivery because GitHub is having a bad minute trades a real outage for a
  // question about how broad the operator's own credential is.
  test("passes a token GitHub would not answer for, and does not remember it", async () => {
    github("admin:org_hook", 500);

    assert.deepEqual(await excessScopes("unanswerable"), []);
    assert.equal(asked, 1);

    github("admin:org_hook");
    assert.deepEqual(await excessScopes("unanswerable"), ["admin:org_hook"]);
  });
});
