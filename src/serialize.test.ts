import assert from "node:assert/strict";
import { test } from "node:test";

import type { SerializedRequest } from "./serialize.ts";
import { fromSerializedRequest, toSerializedRequest } from "./serialize.ts";

test("round-trips a POST request with headers and body", async () => {
  const original = new Request("https://discord.com/api/webhooks/1/token?with_components=true", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-github-event": "push",
    },
    body: JSON.stringify({ content: "hello" }),
  });

  const restored = fromSerializedRequest(await toSerializedRequest(original));

  assert.equal(restored.url, "https://discord.com/api/webhooks/1/token?with_components=true");
  assert.equal(restored.method, "POST");
  assert.equal(restored.headers.get("content-type"), "application/json");
  assert.equal(restored.headers.get("x-github-event"), "push");
  assert.equal(await restored.text(), '{"content":"hello"}');
});

test("carries the time the event occurred", async () => {
  const serialized = await toSerializedRequest(new Request("https://example.com/"), 1_700_000_000);

  assert.equal(serialized.occurredAt, 1_700_000_000);
});

test("serializes the body as a Uint8Array", async () => {
  const serialized = await toSerializedRequest(
    new Request("https://example.com/", { method: "POST", body: "hello" }),
  );

  assert.ok(serialized.body instanceof Uint8Array);
  assert.equal(new TextDecoder().decode(serialized.body), "hello");
});

test("rejects a body the queue serialized as JSON rather than v8", async () => {
  const serialized = await toSerializedRequest(
    new Request("https://discord.com/api/webhooks/1/token?with_components=true", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "hello" }),
    }),
  );

  // What a queue sending `contentType: "json"` delivers: the Uint8Array arrives as `{"0":123,…}`.
  const delivered = JSON.parse(JSON.stringify(serialized)) as SerializedRequest;

  assert.throws(() => fromSerializedRequest(delivered), {
    name: "TypeError",
    message: /Uint8Array/,
  });
});

test("restores a bodyless GET request without throwing", async () => {
  const restored = fromSerializedRequest(await toSerializedRequest(new Request("https://a.test/")));

  assert.equal(restored.method, "GET");
  assert.equal(await restored.text(), "");
});
