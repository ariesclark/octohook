import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { phrases, t, tOf } from "./messages.ts";

/**
 * Not what a phrase says — that is a translator's to change, and messageformat's to render. What
 * can break here is the catalogue itself: a source that no longer parses, or a placeholder the
 * caller does not fill, both of which throw at the moment the log tries to speak.
 */
describe("the catalogue", () => {
  const values = { count: 2, done: 1, total: 2, minutes: 1, seconds: 2 };

  test("every phrase renders, and says something", () => {
    for (const name of phrases) {
      assert.doesNotThrow(() => t(name, values), `${name} did not render`);
      assert.notEqual(t(name, values), "", name);
    }
  });
});

describe("sayOf", () => {
  test("says the phrase GitHub's word maps to", () => {
    assert.equal(tOf("check", "success"), "passed");
    assert.equal(tOf("deployment", "in_progress"), "deploying to");
  });

  // GitHub adds conclusions and states without warning; a log that drops them says less than one
  // that repeats a word it does not know, and tidying the word up would be inventing wording.
  test("repeats a word the catalogue has no phrase for, exactly as it arrived", () => {
    assert.equal(tOf("check", "quantum_entangled"), "quantum_entangled");
  });

  test("says the fallback when there is no word at all", () => {
    assert.equal(tOf("check", null, "is running"), "is running");
    assert.equal(tOf("check", undefined), "");
  });
});
