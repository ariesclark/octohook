import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { withoutUploads } from "./uploads.ts";

describe("a message the channel cannot carry a file for", () => {
  const uploaded = {
    username: "GitHub",
    attachments: [{ id: 0, filename: "authors.png" }],
    components: [
      {
        type: 9,
        accessory: { type: 11, media: { url: "attachment://authors.png" } },
        components: [{ type: 10, content: "pushed 3 new commits" }],
      },
      { type: 10, content: "abc1234 a commit" },
    ],
  };

  test("drops the upload it can no longer send", () => {
    assert.equal("attachments" in withoutUploads(uploaded), false);
  });

  test("keeps every word the section was holding", () => {
    const drawn = JSON.stringify(withoutUploads(uploaded));

    assert.match(drawn, /pushed 3 new commits/);
    assert.match(drawn, /abc1234 a commit/);
    assert.doesNotMatch(drawn, /attachment:\/\//);
  });

  test("leaves a message with nothing attached exactly as it was", () => {
    const plain = { username: "GitHub", components: [{ type: 10, content: "starred" }] };

    assert.deepEqual(withoutUploads(plain), plain);
  });

  test("keeps a thumbnail that names a real url", () => {
    const linked = {
      components: [
        {
          type: 9,
          accessory: { type: 11, media: { url: "https://avatars.githubusercontent.com/u/1" } },
          components: [{ type: 10, content: "pushed" }],
        },
      ],
    };

    assert.deepEqual(withoutUploads(linked), linked);
  });
});
