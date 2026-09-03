import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { diffstatBlocks } from "./diffstat.ts";

describe("the five blocks GitHub draws beside a diff", () => {
  it("gives each side the whole blocks its share earns, and leaves the rest empty", () => {
    assert.deepEqual(diffstatBlocks(13, 1), ["added", "added", "added", "added", "empty"]);
  });

  it("splits an even diff down the middle", () => {
    assert.deepEqual(diffstatBlocks(50, 50), ["added", "added", "removed", "removed", "empty"]);
  });

  it("draws a deletion-only diff in red", () => {
    assert.deepEqual(diffstatBlocks(0, 40), [
      "removed",
      "removed",
      "removed",
      "removed",
      "removed",
    ]);
  });

  it("leaves every block empty when nothing changed", () => {
    assert.deepEqual(diffstatBlocks(0, 0), ["empty", "empty", "empty", "empty", "empty"]);
  });

  // Read off the widget itself: +13 −1 draws four green and an empty, not a red sliver.
  it("leaves a side that changed too little to earn a whole block uncoloured", () => {
    assert.deepEqual(diffstatBlocks(999, 1), ["added", "added", "added", "added", "empty"]);
  });
});
