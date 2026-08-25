import { describe, expect, it } from "vitest";

import { characterCount, maximumCharacters, type MessageComponent } from "../src/discord/limits";
import { getPushContent } from "../src/discord/events/push";

const repository = {
  name: "flirtual",
  full_name: "flirtual/flirtual",
  html_url: "https://github.com/flirtual/flirtual",
};

const commit = (index: number) => ({
  id: `${index}`.padStart(40, "0"),
  message: `fix: a change that carries a reasonably wordy subject line, number ${index}`,
  author: { name: "Aries", username: "ariesclark" },
  url: `https://github.com/flirtual/flirtual/commit/${index}`,
});

const pushed = (count: number) =>
  ({
    ref: "refs/heads/production",
    before: "cfee5197ac1c",
    after: "70891790a5ae",
    compare: "https://github.com/flirtual/flirtual/compare/cfee5197ac1c...70891790a5ae",
    created: false,
    deleted: false,
    forced: false,
    commits: Array.from({ length: count }, (_, index) => commit(index)),
    repository,
    sender: { login: "kfarwell", avatar_url: "https://avatars.githubusercontent.com/u/2" },
  }) as never;

const drawn = async (count: number) => {
  const content = await getPushContent(pushed(count), "organization");
  return ((content as { components?: unknown[] }).components ?? []) as MessageComponent[];
};

describe("a push nobody could read in one sitting", () => {
  it("keeps every component inside what Discord will take", async () => {
    for (const component of await drawn(573))
      expect(characterCount([component])).toBeLessThanOrEqual(maximumCharacters);
  });

  it("says how many commits it did not list", async () => {
    expect(JSON.stringify(await drawn(573))).toContain("563 more");
  });

  it("lists a small push whole, and says nothing about a remainder", async () => {
    const components = await drawn(4);

    expect(JSON.stringify(components)).not.toContain("more");
    expect(JSON.stringify(components)).toContain("number 3");
  });
});
