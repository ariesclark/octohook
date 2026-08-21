import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { authorsByContribution } from "./contribution.ts";

const commit = (
  username: string | undefined,
  files: { added?: string[]; removed?: string[]; modified?: string[] } = {},
) => ({
  id: "0".repeat(40),
  url: "https://example.com",
  message: "chore: something",
  author: { name: username ?? "Someone", username },
  added: files.added ?? [],
  removed: files.removed ?? [],
  modified: files.modified ?? [],
});

describe("authorsByContribution", () => {
  it("puts the author of the most commits first", () => {
    const commits = [commit("alice"), commit("bob"), commit("bob"), commit("carol"), commit("bob")];

    assert.deepEqual(authorsByContribution(commits), ["bob", "alice", "carol"]);
  });

  it("breaks a tie on how many files were touched", () => {
    const commits = [
      commit("alice", { modified: ["a"] }),
      commit("bob", { added: ["a", "b"], removed: ["c"] }),
    ];

    assert.deepEqual(authorsByContribution(commits), ["bob", "alice"]);
  });

  it("keeps first appearance when commits and files both tie", () => {
    const commits = [commit("alice", { modified: ["a"] }), commit("bob", { modified: ["b"] })];

    assert.deepEqual(authorsByContribution(commits), ["alice", "bob"]);
  });

  it("ignores commits with no username", () => {
    assert.deepEqual(authorsByContribution([commit(undefined), commit("alice")]), ["alice"]);
  });

  it("returns nothing for no commits", () => {
    assert.deepEqual(authorsByContribution([]), []);
  });
});
