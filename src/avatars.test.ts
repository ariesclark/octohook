import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { avatarSources, compositeUrl } from "./avatars.ts";

const origin = "https://octohook.aries.fyi";
const one = "https://avatars.githubusercontent.com/u/1?v=4";
const two = "https://avatars.githubusercontent.com/u/2?v=4";

describe("where a thumbnail points", () => {
  test("sends a reader straight to the only avatar there is", () => {
    assert.equal(compositeUrl(origin, [one]), one);
  });

  test("asks the worker to draw the several into one", () => {
    const drawn = new URL(compositeUrl(origin, [one, two]));

    assert.equal(drawn.origin, origin);
    assert.equal(drawn.pathname, "/avatars");
    assert.deepEqual(drawn.searchParams.getAll("u"), [one, two]);
  });
});

describe("what the worker will draw", () => {
  test("takes the avatars GitHub serves", () => {
    const asked = new URL(`${origin}/avatars?u=${encodeURIComponent(one)}`);

    assert.deepEqual(avatarSources(asked), [one]);
  });

  test("refuses anywhere else, so the worker fetches nothing it was told to", () => {
    for (const url of [
      "https://example.com/pic.png",
      "http://avatars.githubusercontent.com/u/1",
      "https://avatars.githubusercontent.com.evil.test/u/1",
      "file:///etc/passwd",
    ])
      assert.deepEqual(
        avatarSources(new URL(`${origin}/avatars?u=${encodeURIComponent(url)}`)),
        [],
      );
  });

  test("draws nothing when asked for nothing", () => {
    assert.deepEqual(avatarSources(new URL(`${origin}/avatars`)), []);
  });

  test("stops at a handful, however many it is handed", () => {
    const many = Array.from({ length: 12 }, (_, index) =>
      encodeURIComponent(`https://avatars.githubusercontent.com/u/${index}`),
    );

    assert.equal(avatarSources(new URL(`${origin}/avatars?u=${many.join("&u=")}`)).length, 4);
  });
});
