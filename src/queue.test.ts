import assert from "node:assert/strict";
import { test } from "node:test";

import { deserializeRequest, serializeRequest } from "./queue.ts";

test("round-trips a POST request with headers and body", async () => {
  const original = new Request("https://discord.com/api/webhooks/1/token/github", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-github-event": "push",
    },
    body: JSON.stringify({ action: "created" }),
  });

  const message = await serializeRequest(original.clone());
  const restored = deserializeRequest(message);

  assert.equal(restored.url, "https://discord.com/api/webhooks/1/token/github");
  assert.equal(restored.method, "POST");
  assert.equal(restored.headers.get("content-type"), "application/json");
  assert.equal(restored.headers.get("x-github-event"), "push");
  assert.equal(await restored.text(), '{"action":"created"}');
});

test("serializes the body as a Uint8Array", async () => {
  const message = await serializeRequest(
    new Request("https://example.com/", { method: "POST", body: "hello" })
  );

  assert.ok(message.body instanceof Uint8Array);
  assert.equal(new TextDecoder().decode(message.body), "hello");
});

test("round-trips a bodyless GET request without throwing", async () => {
  const message = await serializeRequest(new Request("https://example.com/"));
  const restored = deserializeRequest(message);

  assert.equal(restored.method, "GET");
  assert.equal(await restored.text(), "");
});
