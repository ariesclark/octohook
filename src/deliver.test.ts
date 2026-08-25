import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  deliverAll,
  discordTransport,
  type Content,
  type Held,
  type Transport,
} from "./deliver.ts";
import { splitComponents } from "./discord/limits.ts";

function transport(remove: (messageId: string) => Promise<boolean>): Transport & {
  removed: string[];
} {
  const removed: string[] = [];

  return {
    removed,
    async send(_content: Content, messageId?: string) {
      return messageId ?? "posted";
    },
    async remove(messageId: string) {
      const gone = await remove(messageId);
      if (gone) removed.push(messageId);

      return gone;
    },
    split: splitComponents,
  };
}

function heldWith(...keys: string[]): Map<string, Held> {
  return new Map(keys.map((key) => [key, { ids: [`id-${key}`], drawn: "{}" }]));
}

describe("deliverAll, taking a message down", () => {
  test("keeps what it could not delete, so the next draw tries again", async () => {
    const held = heldWith("run:1");
    const records: Array<[string, Held | undefined]> = [];

    const outcome = await deliverAll(
      [],
      transport(async () => false),
      held,
      (key, value) => records.push([key, value]),
    );

    assert.equal(outcome.removed, 0);
    assert.equal(held.has("run:1"), true);
    assert.deepEqual(records, []);
  });

  test("forgets what it did delete", async () => {
    const held = heldWith("run:1");

    const outcome = await deliverAll(
      [],
      transport(async () => true),
      held,
      () => {},
    );

    assert.equal(outcome.removed, 1);
    assert.equal(held.has("run:1"), false);
  });

  test("takes down only as many as it is given, and says how many are left", async () => {
    const keys = Array.from({ length: 40 }, (_, index) => `run:${index}`);
    const held = heldWith(...keys);

    const outcome = await deliverAll(
      [],
      transport(async () => true),
      held,
      () => {},
      "",
      { deletionBudget: 25 },
    );

    assert.equal(outcome.removed, 25);
    assert.equal(outcome.pending, 15);
    assert.equal(held.size, 15);
  });

  test("spends its budget on tries, not on wins", async () => {
    const keys = Array.from({ length: 40 }, (_, index) => `run:${index}`);
    const held = heldWith(...keys);

    const outcome = await deliverAll(
      [],
      transport(async () => false),
      held,
      () => {},
      "",
      { deletionBudget: 25 },
    );

    assert.equal(outcome.removed, 0);
    assert.equal(outcome.pending, 40);
    assert.equal(held.size, 40);
  });

  test("counts what it could not delete as still pending", async () => {
    const held = heldWith("run:1", "run:2");

    const outcome = await deliverAll(
      [],
      transport(async (messageId) => messageId !== "id-run:1"),
      held,
      () => {},
    );

    assert.equal(outcome.removed, 1);
    assert.equal(outcome.pending, 1);
  });
});

describe("deliverOne, shedding the parts it no longer needs", () => {
  test("keeps a spare it could not take down", async () => {
    const held = new Map<string, Held>([["k", { ids: ["a", "b"], drawn: "old" }]]);
    const records: Array<[string, Held | undefined]> = [];

    await deliverAll(
      [{ key: "k", at: "", content: { components: [{ type: 10, content: "one" }] } }],
      transport(async () => false),
      held,
      (key, value) => records.push([key, value]),
    );

    assert.deepEqual(held.get("k")!.ids, ["a", "b"]);
    assert.deepEqual(records.at(-1)![1]!.ids, ["a", "b"]);
  });

  test("forgets a spare it did take down", async () => {
    const held = new Map<string, Held>([["k", { ids: ["a", "b"], drawn: "old" }]]);

    await deliverAll(
      [{ key: "k", at: "", content: { components: [{ type: 10, content: "one" }] } }],
      transport(async () => true),
      held,
      () => {},
    );

    assert.deepEqual(held.get("k")!.ids, ["a"]);
  });
});

describe("discordTransport.remove", () => {
  const answers = (responses: Array<{ status: number; body?: unknown }>) => {
    const calls: string[] = [];
    const original = globalThis.fetch;

    globalThis.fetch = (async (url: string, options?: { method?: string }) => {
      calls.push(`${options?.method} ${url}`);
      const next = responses.shift() ?? { status: 204 };

      return {
        status: next.status,
        ok: next.status < 300,
        async json() {
          return next.body ?? {};
        },
        async text() {
          return "";
        },
      };
    }) as unknown as typeof fetch;

    return { calls, restore: () => (globalThis.fetch = original) };
  };

  test("says a message is gone when Discord took it", async () => {
    const { calls, restore } = answers([{ status: 204 }]);

    try {
      assert.equal(await discordTransport("id/token").remove("7"), true);
      assert.equal(calls.length, 1);
      assert.match(calls[0]!, /^DELETE /);
    } finally {
      restore();
    }
  });

  test("gives up rather than looping when a rate limit says nothing useful", async () => {
    const { calls, restore } = answers([{ status: 429, body: { detail: "slow down" } }]);

    try {
      assert.equal(await discordTransport("id/token").remove("7"), false);
      assert.equal(calls.length, 1);
    } finally {
      restore();
    }
  });

  test("survives a rate limit whose body is not json", async () => {
    const original = globalThis.fetch;

    globalThis.fetch = (async () => ({
      status: 429,
      ok: false,
      async json() {
        throw new Error("not json");
      },
    })) as unknown as typeof fetch;

    try {
      assert.equal(await discordTransport("id/token").remove("7"), false);
    } finally {
      globalThis.fetch = original;
    }
  });

  test("waits out a rate limit rather than losing the message", async () => {
    const { calls, restore } = answers([
      { status: 429, body: { retry_after: 0 } },
      { status: 204 },
    ]);

    try {
      assert.equal(await discordTransport("id/token").remove("7"), true);
      assert.equal(calls.length, 2);
    } finally {
      restore();
    }
  });

  test("treats a message Discord no longer has as gone", async () => {
    const { restore } = answers([{ status: 404 }]);

    try {
      assert.equal(await discordTransport("id/token").remove("7"), true);
    } finally {
      restore();
    }
  });

  test("refuses to forget a message it failed to delete", async () => {
    const { restore } = answers([{ status: 500 }]);

    try {
      assert.equal(await discordTransport("id/token").remove("7"), false);
    } finally {
      restore();
    }
  });
});
