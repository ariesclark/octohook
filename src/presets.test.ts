import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { presets, queryOf, unreadable } from "./options.ts";

describe("a named default", () => {
  test("stands in for the query it spells out", () => {
    assert.deepEqual(queryOf({ preset: "recommended" }), {
      include: undefined,
      exclude: presets.recommended,
    });
  });

  test("gives way to nothing: a query of your own is kept alongside it", () => {
    const query = queryOf({ preset: "recommended", exclude: "type:star" });

    assert.equal(query.exclude, `(${presets.recommended}) OR (type:star)`);
  });

  test("is refused by name when nobody knows it", () => {
    assert.deepEqual(unreadable(queryOf({ preset: "whatever" })), ["preset"]);
    assert.equal(queryOf({ preset: "whatever" }).exclude, "preset:whatever");
  });

  test("leaves a hook with no preset alone", () => {
    assert.deepEqual(queryOf({ exclude: "type:star" }), {
      include: undefined,
      exclude: "type:star",
    });
  });
});
